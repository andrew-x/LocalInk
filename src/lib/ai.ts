import "server-only";

import {
  createOpenRouter,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import { type CallSettings, generateText, type Prompt } from "ai";

export const LOCALINK_AI_MODELS = {
  main: "deepseek/deepseek-v4-pro",
  fast: "deepseek/deepseek-v4-flash",
} as const;

export type LocalinkAiModel = keyof typeof LOCALINK_AI_MODELS;
export type LocalinkAiModelId = (typeof LOCALINK_AI_MODELS)[LocalinkAiModel];

export type GenerateLocalinkTextOptions = Prompt &
  CallSettings & {
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
