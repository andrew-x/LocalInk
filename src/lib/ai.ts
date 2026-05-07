import "server-only";

import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { type CallSettings, type Prompt, streamText } from "ai";

const LOCALINK_AI_MODELS = {
  main: "deepseek/deepseek-v4-pro",
  fast: "deepseek/deepseek-v4-flash",
} as const;

export type LocalinkAiModel = keyof typeof LOCALINK_AI_MODELS;
export type LocalinkProviderOptions = NonNullable<
  Parameters<typeof streamText>[0]["providerOptions"]
>;

export type StreamLocalinkTextOptions = Prompt &
  CallSettings & {
    abortSignal?: AbortSignal;
    onAbort?: () => PromiseLike<void> | void;
    onError?: (event: { error: unknown }) => PromiseLike<void> | void;
    onFinish?: () => PromiseLike<void> | void;
    model?: LocalinkAiModel;
    providerOptions?: LocalinkProviderOptions;
  };

let cachedOpenRouter: OpenRouterProvider | null = null;

function getOpenRouterProvider(): OpenRouterProvider {
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

function getLocalinkLanguageModel(model: LocalinkAiModel = "main") {
  return getOpenRouterProvider().chat(LOCALINK_AI_MODELS[model]);
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
