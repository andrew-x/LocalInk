import "server-only";

import { type ModelMessage, stepCountIs } from "ai";
import { z } from "zod";

import { LOCALINK_AI_MODEL_PROFILES, streamLocalinkChat } from "@/lib/ai";
import type {
  StudioChatContext,
  StudioChatStep,
} from "@/lib/studio/chat-contract";
import type { StudioWorkspace } from "@/lib/studio/contracts";
import { STUDIO_ASSIST_MODEL } from "@/lib/studio/models";

import { StudioBundleBuilder } from "./bundle-builder";
import {
  buildStudioChatContextBlock,
  buildStudioChatSystemPrompt,
  type StudioChatContextParts,
} from "./chat-context";
import type { StudioChatToolBudget } from "./chat-read-tools";
import { createStudioChatToolRepair } from "./chat-tool-repair";
import { createStudioChatTools } from "./chat-tools";
import { StudioContextTooLargeError } from "./prompt-kit";

/**
 * The agent chat's tool loop. Copies the story chat's budgeting: the input
 * budget is the model's context window minus an output reserve and a tool
 * framing reserve, measured in UTF-8 bytes (a conservative stand-in for
 * tokens). Before every model call, whole oldest turns are dropped first,
 * then the outline (the context in the system prompt); the current user
 * message is never cut. If it still does not fit, the turn fails with a clear error. What is
 * left is the room tool results may use in that step; a read that would
 * not fit returns `{ error }` instead.
 */

const OUTPUT_RESERVE = 32_768;
const TOOL_FRAMING_RESERVE = 16_384;
const MAX_STEPS = 12;
const MAX_OUTPUT_TOKENS = 32_768;
const MAX_TEMPERATURE = 0.8;

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function createStudioChatGeneration({
  workspace,
  context,
  history,
  globalInstructions,
  abortSignal,
  onProgress,
}: {
  workspace: StudioWorkspace;
  context: StudioChatContext;
  /** Earlier turns, then the current user message last. */
  history: ModelMessage[];
  globalInstructions: string;
  abortSignal: AbortSignal;
  onProgress: (step: StudioChatStep) => void;
}) {
  const storyId = workspace.story.id;
  const profile = LOCALINK_AI_MODEL_PROFILES[STUDIO_ASSIST_MODEL];
  const builder = new StudioBundleBuilder(storyId);
  const budget: StudioChatToolBudget = { remaining: 0 };
  const { tools, schemas } = createStudioChatTools({
    storyId,
    builder,
    budget,
    globalInstructions,
    abortSignal,
    onProgress,
  });
  const baseSystem = buildStudioChatSystemPrompt({
    globalInstructions,
    storyInstructions: workspace.story.instructions,
  });
  const inputBudget =
    profile.contextWindowTokens - OUTPUT_RESERVE - TOOL_FRAMING_RESERVE;
  const toolBytes =
    byteSize(schemas.map((schema) => z.toJSONSchema(schema))) +
    byteSize(Object.values(tools).map((item) => item.description ?? ""));

  // The context rides in the system prompt (rebuilt each step), so the
  // messages hold only the conversation and this turn's tool calls.
  const parts: StudioChatContextParts = {
    omittedHistory: false,
    outline: true,
  };
  const systemByParts = new Map<string, string>();
  const system = () => {
    const key = JSON.stringify(parts);
    let text = systemByParts.get(key);
    if (text === undefined) {
      text = `${baseSystem}\n\n${buildStudioChatContextBlock(workspace, context, parts)}`;
      systemByParts.set(key, text);
    }
    return text;
  };
  const count = (messages: ModelMessage[]) =>
    byteSize(messages) + Buffer.byteLength(system(), "utf8") + toolBytes;

  const fit = (messages: ModelMessage[]): ModelMessage[] => {
    const fitted = [...messages];
    // Whole oldest turns go first; the last user message always stays.
    while (count(fitted) > inputBudget) {
      const firstUser = fitted.findIndex((message) => message.role === "user");
      const nextUser = fitted.findIndex(
        (message, index) => index > firstUser && message.role === "user",
      );
      if (firstUser < 0 || nextUser < 0) break;
      fitted.splice(firstUser, nextUser - firstUser);
      parts.omittedHistory = true;
    }
    if (count(fitted) > inputBudget && parts.outline) parts.outline = false;
    if (count(fitted) > inputBudget) {
      throw new StudioContextTooLargeError(
        "This chat no longer fits the chat model's context. Start a new chat, shorten the message, or choose a model with a larger context window.",
      );
    }
    return fitted;
  };

  const initialMessages = fit(history);
  // Calls whose omitted nullable keys were filled with null (route log).
  const repairs = { count: 0 };
  const stream = streamLocalinkChat({
    model: profile.model,
    system: system(),
    messages: initialMessages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: Math.min(profile.temperature, MAX_TEMPERATURE),
    abortSignal,
    experimental_repairToolCall: createStudioChatToolRepair(() => {
      repairs.count += 1;
    }),
    prepareStep: ({ messages, stepNumber }) => {
      const stepMessages = fit(messages);
      budget.remaining = inputBudget - count(stepMessages);
      const step = { system: system(), messages: stepMessages };
      // After the proposal is final, or on the last allowed step, the model
      // must answer in text.
      return builder.isFinalized || stepNumber >= MAX_STEPS - 1
        ? { ...step, toolChoice: "none" as const, activeTools: [] }
        : step;
    },
  });
  return { stream, builder, model: profile.model, repairs };
}
