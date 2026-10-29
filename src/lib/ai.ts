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
  contextWindowTokens: number;
  maxCompletionTokens: number;
  temperature: number;
  reasoningEffort?: "none" | "low";
  reasoningOutputTokenAllowance: number;
};

// Venice /models checked 2026-10-28. Kimi is an explicitly accepted Anonymized
// choice; the other profiles are Private. Never substitute another model.
export const LOCALINK_AI_MODEL_PROFILES = {
  "deepseek-v4-1-flash-1017-uncensored": {
    model: "deepseek-v4-1-flash-1017-uncensored",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "deepseek-v4-pro-0813": {
    model: "deepseek-v4-pro-0813",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 32_768,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "kimi-k3-1-pro": {
    model: "kimi-k3-1-pro",
    contextWindowTokens: 1_000_000,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    reasoningEffort: "none",
    reasoningOutputTokenAllowance: 0,
  },
  "grok-4-7": {
    model: "grok-4-7",
    contextWindowTokens: 500_000,
    maxCompletionTokens: 200_000,
    temperature: 0.82,
    reasoningEffort: "low",
    reasoningOutputTokenAllowance: 4_096,
  },
  "z-ai-glm-5-3": {
    model: "z-ai-glm-5-3",
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

export function isVeniceConfigurationError(error: unknown): boolean {
  return (
    (error instanceof Error && error.message.includes("VENICE_API_KEY")) ||
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
    model: getVeniceProvider().chatModel(model),
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
    model: getVeniceProvider().chatModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
  });
}

export function generateLocalinkText({
  model = DEFAULT_STORY_GENERATION_MODEL,
  ...options
}: GenerateLocalinkTextOptions) {
  return generateText({
    ...options,
    model: getVeniceProvider().chatModel(model),
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
    model: getVeniceProvider().chatModel(model),
    maxOutputTokens: boundedOutput(model, options.maxOutputTokens),
    output: Output.object({ schema }),
  });
}
