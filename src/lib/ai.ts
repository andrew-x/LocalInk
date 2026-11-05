import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  type CallSettings,
  type FlexibleSchema,
  generateText,
  Output,
  type Prompt,
  streamText,
  type ToolSet,
} from "ai";

import {
  DEFAULT_STORY_GENERATION_MODEL,
  type StoryGenerationModel,
} from "@/lib/story-generation-models";

export type LocalinkAiModel = StoryGenerationModel;
export type LocalinkAiModelProfile = {
  model: LocalinkAiModel;
  provider: "venice" | "openrouter";
  contextWindowTokens: number;
  maxCompletionTokens: number;
  temperature: number;
  reasoningEffort?: "none" | "low";
  reasoningOutputTokenAllowance: number;
};

// Venice /models checked 2026-10-28 (DeepSeek V4 Pro and V4.1 Flash 1017
// Uncensored rechecked 2026-11-05: both Private, 1M context). Kimi is an
// explicitly accepted Anonymized choice; other Venice profiles are Private.
// OpenRouter Mistral's mistral/zdr endpoint checked 2026-10-31. Never substitute
// another model or provider.
export const LOCALINK_AI_MODEL_PROFILES = {
  "deepseek-v4-1-flash-1017-uncensored": {
    model: "deepseek-v4-1-flash-1017-uncensored",
    provider: "venice",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "deepseek-v4-pro-0813": {
    model: "deepseek-v4-pro-0813",
    provider: "venice",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 262_144,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "mistralai/mistral-large-4-0": {
    model: "mistralai/mistral-large-4-0",
    provider: "openrouter",
    contextWindowTokens: 1_048_576,
    maxCompletionTokens: 262_144,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "kimi-k3-1-pro": {
    model: "kimi-k3-1-pro",
    provider: "venice",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "grok-4-7": {
    model: "grok-4-7",
    provider: "venice",
    contextWindowTokens: 500_000,
    maxCompletionTokens: 200_000,
    temperature: 0.82,
    reasoningEffort: "low",
    reasoningOutputTokenAllowance: 4_096,
  },
  "z-ai-glm-5-3": {
    model: "z-ai-glm-5-3",
    provider: "venice",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    // Venice does not advertise effort selection for this model.
    reasoningOutputTokenAllowance: 4_096,
  },
} satisfies Record<StoryGenerationModel, LocalinkAiModelProfile>;

export const DEFAULT_LOCALINK_AI_PROFILE =
  LOCALINK_AI_MODEL_PROFILES[DEFAULT_STORY_GENERATION_MODEL];

export type StreamLocalinkTextOptions = Prompt &
  CallSettings & {
    abortSignal?: AbortSignal;
    onAbort?: () => PromiseLike<void> | void;
    onError?: (event: { error: unknown }) => PromiseLike<void> | void;
    onFinish?: () => PromiseLike<void> | void;
    model?: LocalinkAiModel;
  };

export type GenerateLocalinkTextOptions = Prompt &
  CallSettings & {
    abortSignal?: AbortSignal;
    model?: LocalinkAiModel;
  };

let cachedVenice: ReturnType<typeof createOpenAICompatible> | null = null;
let cachedOpenRouter: ReturnType<typeof createOpenAICompatible> | null = null;

function getVeniceProvider() {
  if (cachedVenice) return cachedVenice;
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) {
    throw new Error("VENICE_API_KEY must be set before calling Venice.");
  }
  cachedVenice = createOpenAICompatible({
    name: "venice",
    apiKey,
    baseURL: "https://api.venice.ai/api/v1",
    supportsStructuredOutputs: true,
    includeUsage: true,
    transformRequestBody: (body) => {
      const profile: LocalinkAiModelProfile =
        LOCALINK_AI_MODEL_PROFILES[body.model as LocalinkAiModel];
      return {
        ...body,
        ...(profile.reasoningEffort
          ? { reasoning_effort: profile.reasoningEffort }
          : {}),
        venice_parameters: {
          include_venice_system_prompt: false,
          enable_web_search: "off",
          enable_web_scraping: false,
          enable_x_search: false,
          strip_thinking_response: true,
        },
      };
    },
  });
  return cachedVenice;
}

function getOpenRouterProvider() {
  if (cachedOpenRouter) return cachedOpenRouter;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY must be set before calling OpenRouter.",
    );
  }
  cachedOpenRouter = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    supportsStructuredOutputs: true,
    includeUsage: true,
    transformRequestBody: (body) => {
      const profile: LocalinkAiModelProfile =
        LOCALINK_AI_MODEL_PROFILES[body.model as LocalinkAiModel];
      return {
        ...body,
        reasoning: { effort: profile.reasoningEffort, exclude: true },
        provider: {
          zdr: true,
          // Other ZDR endpoints have smaller context windows than this profile.
          only: ["mistral/zdr"],
          allow_fallbacks: false,
          require_parameters: true,
        },
      };
    },
  });
  return cachedOpenRouter;
}

function getLocalinkModel(model: LocalinkAiModel) {
  const provider =
    LOCALINK_AI_MODEL_PROFILES[model].provider === "openrouter"
      ? getOpenRouterProvider()
      : getVeniceProvider();
  return provider.chatModel(model);
}

export function isAiConfigurationError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.message.includes("VENICE_API_KEY") ||
        error.message.includes("OPENROUTER_API_KEY"))) ||
    (APICallError.isInstance(error) &&
      (error.statusCode === 401 || error.statusCode === 403))
  );
}

function boundedOutput(model: LocalinkAiModel, requested?: number) {
  const limit = LOCALINK_AI_MODEL_PROFILES[model].maxCompletionTokens;
  return requested === undefined ? limit : Math.min(requested, limit);
}

export function streamLocalinkText({
  model = DEFAULT_STORY_GENERATION_MODEL,
  ...options
}: StreamLocalinkTextOptions) {
  return streamText({
    ...options,
    model: getLocalinkModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
  });
}

export function streamLocalinkChat<TOOLS extends ToolSet>({
  model = DEFAULT_STORY_GENERATION_MODEL,
  ...options
}: Omit<
  Parameters<typeof streamText<TOOLS>>[0],
  "model" | "providerOptions" | "prompt" | "messages"
> &
  Prompt & {
    model?: LocalinkAiModel;
  }) {
  return streamText({
    ...options,
    model: getLocalinkModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
  });
}

export function generateLocalinkText({
  model = DEFAULT_STORY_GENERATION_MODEL,
  ...options
}: GenerateLocalinkTextOptions) {
  return generateText({
    ...options,
    model: getLocalinkModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
  });
}

export function generateLocalinkObject<OBJECT>({
  model = DEFAULT_STORY_GENERATION_MODEL,
  schema,
  ...options
}: GenerateLocalinkTextOptions & { schema: FlexibleSchema<OBJECT> }) {
  return generateText({
    ...options,
    model: getLocalinkModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
    output: Output.object({ schema }),
  });
}
