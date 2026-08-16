import "server-only";

import {
  createOpenRouter,
  type OpenRouterChatSettings,
  type OpenRouterProvider,
} from "@openrouter/ai-sdk-provider";
import {
  APICallError,
  type CallSettings,
  generateText,
  type Prompt,
  streamText,
} from "ai";

const LOCALINK_AI_MODELS = {
  main: "deepseek/deepseek-v4-pro-0813",
  fast: "deepseek/deepseek-v4-flash-0731",
} as const;

/**
 * Zero Data Retention routing, sent on every OpenRouter request LocalInk makes.
 *
 * LocalInk is a local-first app, so a prompt or manuscript excerpt leaving the
 * machine at all is the exception; when it does, it must only be handled by an
 * endpoint that does not retain it. OpenRouter ORs this with the account-level
 * setting, so the flag can only tighten routing, never loosen it. A model with
 * no ZDR endpoint answers 404 "No endpoints found matching your data policy
 * (Zero data retention)" rather than quietly falling back to a retaining
 * provider, which is the failure mode worth having.
 *
 * Verified 2026-08-16: honored on /api/v1/chat/completions. It is NOT honored on
 * /api/v1/images, which accepts the field and generates anyway — see
 * `docs/ai-image-generation.md` for how the image path covers that gap.
 */
export const OPENROUTER_ZDR_PROVIDER_ROUTING = {
  zdr: true,
} as const satisfies NonNullable<OpenRouterChatSettings["provider"]>;

// Markers from OpenRouter's 404 body when privacy routing leaves no eligible
// endpoint. Matched on the message because the status alone also covers an
// unknown model ID.
//
// Two different wordings reach this check. The `zdr` flag refuses with "No
// endpoints found matching your data policy"; a `provider.only` list that
// matches nothing refuses with "No allowed providers are available". Both count
// here because LocalInk only ever sends `only` to pin a ZDR provider, so either
// message means the same thing to the user.
const ZDR_REFUSAL_MARKERS = [
  "data policy",
  "zero data retention",
  "no allowed providers",
] as const;

export type LocalinkAiModel = keyof typeof LOCALINK_AI_MODELS;
// Note: the OpenRouter provider spreads `providerOptions.openrouter` over the
// request body last and replaces `provider` wholesale rather than merging it, so
// a caller passing `{ openrouter: { provider: ... } }` here would silently drop
// the ZDR routing pinned below. Keep these options limited to `reasoning`.
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

export type GenerateLocalinkTextOptions = Prompt &
  CallSettings & {
    abortSignal?: AbortSignal;
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
  return getOpenRouterProvider().chat(LOCALINK_AI_MODELS[model], {
    provider: OPENROUTER_ZDR_PROVIDER_ROUTING,
  });
}

/**
 * True when OpenRouter refused the request because ZDR routing left no eligible
 * endpoint for the model.
 *
 * Worth separating from a generic outage: it is not transient and retrying will
 * not help, so the caller can say the model has no zero-data-retention provider
 * instead of reporting an unexplained failure.
 */
export function isOpenRouterZdrUnavailableError(error: unknown): boolean {
  return (
    APICallError.isInstance(error) &&
    error.statusCode === 404 &&
    looksLikeOpenRouterZdrUnavailableBody(error.responseBody)
  );
}

/**
 * Same check against a raw response body, for the image paths that call
 * OpenRouter with `fetch` instead of going through the AI SDK. Callers pair it
 * with a 404 status, since the status alone also covers an unknown model ID.
 */
export function looksLikeOpenRouterZdrUnavailableBody(
  body: string | null | undefined,
): boolean {
  const normalized = (body ?? "").toLowerCase();

  return ZDR_REFUSAL_MARKERS.some((marker) => normalized.includes(marker));
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

export function generateLocalinkText({
  model = "main",
  ...options
}: GenerateLocalinkTextOptions) {
  return generateText({
    model: getLocalinkLanguageModel(model),
    ...options,
  });
}
