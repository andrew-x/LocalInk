import "server-only";

import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import {
  type CallSettings,
  embedMany,
  generateText,
  type Prompt,
  streamText,
} from "ai";

export const LOCALINK_AI_MODELS = {
  main: "deepseek/deepseek-v4-pro",
  fast: "deepseek/deepseek-v4-flash",
} as const;

export const LOCALINK_EMBEDDING_MODELS = {
  chapter: "qwen/qwen3-embedding-8b",
} as const;

export type LocalinkAiModel = keyof typeof LOCALINK_AI_MODELS;
export type LocalinkAiModelId = (typeof LOCALINK_AI_MODELS)[LocalinkAiModel];
export type LocalinkEmbeddingModel = keyof typeof LOCALINK_EMBEDDING_MODELS;

export type GenerateLocalinkTextOptions = Prompt &
  CallSettings & {
    model?: LocalinkAiModel;
  };

export type StreamLocalinkTextOptions = Prompt &
  CallSettings & {
    abortSignal?: AbortSignal;
    onAbort?: () => PromiseLike<void> | void;
    onError?: (event: { error: unknown }) => PromiseLike<void> | void;
    onFinish?: () => PromiseLike<void> | void;
    model?: LocalinkAiModel;
  };

let cachedOpenRouter: OpenRouterProvider | null = null;

export function getOpenRouterProvider(): OpenRouterProvider {
  if (cachedOpenRouter) {
    return cachedOpenRouter;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY must be set before calling OpenRouter.",
    );
  }

  cachedOpenRouter = createOpenRouter({
    apiKey,
    appName: process.env.OPENROUTER_APP_NAME ?? "Localink",
    appUrl: process.env.OPENROUTER_APP_URL,
  });

  return cachedOpenRouter;
}

export function getLocalinkLanguageModel(model: LocalinkAiModel = "main") {
  return getOpenRouterProvider().chat(LOCALINK_AI_MODELS[model]);
}

export function getLocalinkEmbeddingModel(
  model: LocalinkEmbeddingModel = "chapter",
) {
  return getOpenRouterProvider().textEmbeddingModel(
    LOCALINK_EMBEDDING_MODELS[model],
  );
}

export async function generateLocalinkText({
  model = "main",
  ...options
}: GenerateLocalinkTextOptions): Promise<string> {
  const result = await generateText({
    model: getLocalinkLanguageModel(model),
    ...options,
  });

  return result.text;
}

export async function embedLocalinkTexts(
  values: string[],
): Promise<number[][]> {
  if (values.length === 0) {
    return [];
  }

  const result = await embedMany({
    model: getLocalinkEmbeddingModel("chapter"),
    values,
  });

  return result.embeddings;
}

export function streamLocalinkText({
  model = "main",
  ...options
}: StreamLocalinkTextOptions) {
  return streamText({
    model: getLocalinkLanguageModel(model),
    ...options,
  });
}
