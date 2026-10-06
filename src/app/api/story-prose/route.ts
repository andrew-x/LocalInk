import {
  isOpenRouterZdrUnavailableError,
  type LocalinkAiModel,
  type LocalinkProviderOptions,
  STORY_GENERATION_AI_MODELS,
  streamLocalinkText,
} from "@/lib/ai";
import { LocalinkTextStreamFinishError } from "@/lib/ai-text-stream";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import { toLocalinkTextStreamResponse } from "@/lib/server/ai-text-stream-response";
import { getAppSettings } from "@/lib/server/app-settings";
import { prepareStoryProseContext } from "@/lib/server/story-prose-context";
import {
  buildBudgetedStoryProsePrompt,
  buildStoryProseSystemPrompt,
  StoryProseContextTooLargeError,
  type StoryProseModelLimits,
} from "@/lib/server/story-prose-generation";
import { saveStoryProsePromptSnapshot } from "@/lib/server/story-prose-prompt-snapshots";
import type { StoryGenerationModel } from "@/lib/story-generation-models";
import {
  type StoryProseGenerationRequest,
  storyProseGenerationRequestSchema,
} from "@/lib/story-prose-generation-contract";

export const runtime = "nodejs";

const storyProseLogger = createLogger("story-prose");
const ACTION_NAME = "story-prose-generate";
const PROMPT_SNAPSHOT_ID_HEADER = "X-Prose-Prompt-Snapshot-Id";
const PROSE_MAX_OUTPUT_TOKENS_BY_LENGTH = {
  200: 700,
  400: 1_200,
  600: 1_700,
  1000: 2_700,
} satisfies Record<
  Exclude<StoryProseGenerationRequest["approximateLength"], "unlimited">,
  number
>;
/**
 * A prose model paired with the sampling settings it should be judged at.
 *
 * Kept as a unit because temperature is not portable between models: reading a
 * model at another model's temperature makes it look worse than it is, which
 * defeats the point of comparing them.
 */
type StoryProseModelProfile = StoryProseModelLimits & {
  model: LocalinkAiModel;
  temperature: number;
  providerOptions?: LocalinkProviderOptions;
  reasoningOutputTokenAllowance?: number;
};

// Prefer direct prose output for models that allow reasoning to be disabled.
const NO_REASONING = {
  openrouter: {
    reasoning: {
      effort: "none",
      exclude: true,
    },
  },
} satisfies LocalinkProviderOptions;

/**
 * Story prose profiles selected for each generation request.
 *
 * All four start at the same temperature so the first comparison is
 * like-for-like against the value DeepSeek was tuned at; tune an individual
 * profile once you have a read on it.
 *
 * All choices retain mandatory ZDR routing; availability checks are recorded
 * in ai.ts. Mistral's 262k context is the smallest of the four.
 * Context/output limits below use the
 * lower advertised model/top-provider context from OpenRouter's public models
 * endpoint, checked 2026-09-22; no request-time metadata lookup is needed.
 */
const STORY_PROSE_MODEL_PROFILES = {
  deepseekV4Pro: {
    model: STORY_GENERATION_AI_MODELS.deepseekV4Pro,
    contextWindowTokens: 1_024_000,
    maxCompletionTokens: 384_000,
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
  kimiK3: {
    model: STORY_GENERATION_AI_MODELS.kimiK3,
    contextWindowTokens: 1_048_576,
    maxCompletionTokens: 943_718,
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
  glm53: {
    model: STORY_GENERATION_AI_MODELS.glm53,
    contextWindowTokens: 1_048_576,
    maxCompletionTokens: 131_072,
    temperature: 0.82,
    // GLM 5.3 requires reasoning; low is its smallest supported effort.
    // Excluding reasoning hides it from output but still consumes tokens.
    // https://openrouter.ai/z-ai/glm-5.3 (checked 2026-10-06)
    providerOptions: {
      openrouter: { reasoning: { effort: "low", exclude: true } },
    },
    // Extra completion headroom for bounded drafts, not a hard reasoning cap.
    reasoningOutputTokenAllowance: 4_096,
  },
  mistralMedium35: {
    model: STORY_GENERATION_AI_MODELS.mistralMedium35,
    contextWindowTokens: 262_144,
    maxCompletionTokens: 209_715,
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
} as const satisfies Record<StoryGenerationModel, StoryProseModelProfile>;

// A fresh alternative reuses the brief, the insertion point, and the whole
// manuscript, so the only things separating it from the draft the writer just
// set aside are the prior-attempt block and sampling. Give sampling more room.
// Added to the active profile's temperature rather than replacing it, so a
// per-model tuning still carries.
const PROSE_FRESH_ALTERNATIVE_TEMPERATURE_BOOST = 0.13;
const PROSE_MAX_TEMPERATURE = 1;

type StoryProseRouteError = {
  code:
    | "AI_NOT_CONFIGURED"
    | "AI_ZDR_UNAVAILABLE"
    | "BAD_REQUEST"
    | "GENERATION_FAILED"
    | "STREAM_OUTPUT_LIMIT"
    | "STREAM_CONTENT_FILTERED"
    | "STREAM_INCOMPLETE"
    | "STREAM_FAILED"
    | "MANUSCRIPT_CONTEXT_TOO_LARGE";
  message: string;
  status: number;
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = day();
  let parsedInput: StoryProseGenerationRequest | null = null;

  try {
    const body = await request.json();
    const result = storyProseGenerationRequestSchema.safeParse(body);

    if (!result.success) {
      const routeError: StoryProseRouteError = {
        code: "BAD_REQUEST",
        message: "The prose generation request is invalid.",
        status: 400,
      };

      storyProseLogger.info("end", {
        action: ACTION_NAME,
        errorCode: routeError.code,
        success: false,
        durationMs: day().diff(startedAt),
      });

      return errorResponse(routeError);
    }

    parsedInput = result.data;
    const profile = STORY_PROSE_MODEL_PROFILES[parsedInput.model];
    storyProseLogger.info("start", {
      action: ACTION_NAME,
      model: profile.model,
      storyId: parsedInput.story.id,
      chapterId: parsedInput.focusedChapter.id,
      approximateLength: parsedInput.approximateLength,
    });

    const [settings, preparedInput] = await Promise.all([
      getAppSettings(),
      prepareStoryProseContext(parsedInput),
    ]);

    const systemPrompt = buildStoryProseSystemPrompt(
      settings.systemInstructions,
      parsedInput.story.systemInstructions,
    );
    const { prompt: prosePrompt, maxOutputTokens } =
      buildBudgetedStoryProsePrompt(preparedInput, {
        system: systemPrompt,
        contextWindowTokens: profile.contextWindowTokens,
        maxCompletionTokens: profile.maxCompletionTokens,
        requestedOutputTokens: getProseMaxOutputTokens(
          parsedInput.approximateLength,
          profile,
        ),
      });
    const promptSnapshot = saveStoryProsePromptSnapshot({
      approximateLength: parsedInput.approximateLength,
      prompt: prosePrompt,
      regeneration: parsedInput.regeneration,
      system: systemPrompt,
    });
    const stream = streamLocalinkText({
      model: profile.model,
      providerOptions: profile.providerOptions,
      temperature: getProseTemperature(parsedInput, profile),
      system: systemPrompt,
      prompt: prosePrompt,
      abortSignal: request.signal,
      maxOutputTokens,
    });

    return toLocalinkTextStreamResponse({
      stream,
      requestSignal: request.signal,
      toRouteError,
      onAbort: () => {
        logEnd(startedAt, parsedInput, "aborted");
      },
      onComplete: () => {
        logEnd(startedAt, parsedInput, "complete");
      },
      onError: (error, routeError) => {
        storyProseLogger.error("error", {
          action: ACTION_NAME,
          storyId: parsedInput?.story.id,
          chapterId: parsedInput?.focusedChapter.id,
          approximateLength: parsedInput?.approximateLength,
          errorCode: routeError.code,
          errorName: getErrorName(error),
          durationMs: day().diff(startedAt),
        });
        logEnd(startedAt, parsedInput, "error", routeError.code);
      },
      headers: {
        [PROMPT_SNAPSHOT_ID_HEADER]: promptSnapshot.id,
      },
    });
  } catch (error) {
    const routeError = toRouteError(error);

    storyProseLogger.error("error", {
      action: ACTION_NAME,
      storyId: parsedInput?.story.id,
      chapterId: parsedInput?.focusedChapter.id,
      approximateLength: parsedInput?.approximateLength,
      errorCode: routeError.code,
      errorName: getErrorName(error),
      durationMs: day().diff(startedAt),
    });
    logEnd(startedAt, parsedInput, "error", routeError.code);

    return errorResponse(routeError);
  }
}

function logEnd(
  startedAt: ReturnType<typeof day>,
  input: StoryProseGenerationRequest | null,
  status: "aborted" | "complete" | "error",
  errorCode?: StoryProseRouteError["code"],
) {
  storyProseLogger.info("end", {
    action: ACTION_NAME,
    storyId: input?.story.id,
    chapterId: input?.focusedChapter.id,
    approximateLength: input?.approximateLength,
    status,
    errorCode,
    success: status === "complete",
    durationMs: day().diff(startedAt),
  });
}

function toRouteError(error: unknown): StoryProseRouteError {
  if (error instanceof StoryProseContextTooLargeError) {
    return {
      code: "MANUSCRIPT_CONTEXT_TOO_LARGE",
      message: error.message,
      status: 413,
    };
  }

  if (error instanceof LocalinkTextStreamFinishError) {
    return { code: error.code, message: error.message, status: 500 };
  }
  if (isMissingOpenRouterApiKeyError(error)) {
    return {
      code: "AI_NOT_CONFIGURED",
      message:
        "AI generation is not configured. Add the OpenRouter API key and try again.",
      status: 503,
    };
  }

  if (isOpenRouterZdrUnavailableError(error)) {
    return {
      code: "AI_ZDR_UNAVAILABLE",
      message:
        "AI generation is unavailable because no zero-data-retention provider is currently serving the writing model.",
      status: 503,
    };
  }

  return {
    code: "GENERATION_FAILED",
    message: "The prose could not be generated.",
    status: 500,
  };
}

function isMissingOpenRouterApiKeyError(error: unknown) {
  return error instanceof Error && error.message.includes("OPENROUTER_API_KEY");
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function getProseTemperature(
  input: StoryProseGenerationRequest,
  profile: StoryProseModelProfile,
): number {
  if (input.regeneration?.mode !== "fresh-alternative") {
    return profile.temperature;
  }

  return Math.min(
    profile.temperature + PROSE_FRESH_ALTERNATIVE_TEMPERATURE_BOOST,
    PROSE_MAX_TEMPERATURE,
  );
}

function getProseMaxOutputTokens(
  approximateLength: StoryProseGenerationRequest["approximateLength"],
  profile: StoryProseModelProfile,
): number | undefined {
  if (approximateLength === "unlimited") {
    return undefined;
  }

  return (
    PROSE_MAX_OUTPUT_TOKENS_BY_LENGTH[approximateLength] +
    (profile.reasoningOutputTokenAllowance ?? 0)
  );
}

function errorResponse(error: StoryProseRouteError): Response {
  return Response.json(
    {
      code: error.code,
      message: error.message,
    },
    { status: error.status },
  );
}
