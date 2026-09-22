import {
  isOpenRouterZdrUnavailableError,
  type LocalinkAiModel,
  type LocalinkProviderOptions,
  streamLocalinkText,
} from "@/lib/ai";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import { toLocalinkTextStreamResponse } from "@/lib/server/ai-text-stream-response";
import { getAppSettings } from "@/lib/server/app-settings";
import {
  buildStoryProsePrompt,
  buildStoryProseSystemPrompt,
  getStoryProseManuscriptContextCharCount,
  STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT,
} from "@/lib/server/story-prose-generation";
import { saveStoryProsePromptSnapshot } from "@/lib/server/story-prose-prompt-snapshots";
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
type StoryProseModelProfile = {
  model: LocalinkAiModel;
  temperature: number;
  providerOptions?: LocalinkProviderOptions;
};

// Reasoning modes are useful for analysis but counterproductive for fiction
// drafting: the output budget should go to the draft, not to hidden or visible
// thinking. Drop this from an individual profile if that model rejects
// `effort: "none"` or emits reasoning anyway.
const NO_REASONING = {
  openrouter: {
    reasoning: {
      effort: "none",
      exclude: true,
    },
  },
} satisfies LocalinkProviderOptions;

/**
 * Story prose model candidates, for hand-comparing fiction drafting quality.
 *
 * All four start at the same temperature so the first comparison is
 * like-for-like against the value DeepSeek was tuned at; tune an individual
 * profile once you have a read on it.
 *
 * ZDR endpoints verified 2026-09-21: DeepSeek V4 Pro 6, Kimi K3 18, GLM 5.3 27,
 * Mistral Medium 3.5 1. Mistral has only a first-party ZDR endpoint, so an
 * outage there surfaces as AI_ZDR_UNAVAILABLE with no reroute, and its 262k
 * context is the smallest of the four — still well clear of
 * STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT.
 */
const STORY_PROSE_MODEL_PROFILES = {
  deepseekV4Pro: {
    model: "prose-deepseek-v4-pro",
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
  kimiK3: {
    model: "prose-kimi-k3",
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
  glm53: {
    model: "prose-glm-5.3",
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
  mistralMedium35: {
    model: "prose-mistral-medium-3.5",
    temperature: 0.82,
    providerOptions: NO_REASONING,
  },
} as const satisfies Record<string, StoryProseModelProfile>;

type StoryProseModelKey = keyof typeof STORY_PROSE_MODEL_PROFILES;

// --- Active story prose model. Uncomment exactly one; restart to apply. ---
//
// Uncommenting two is a duplicate declaration, so it fails the build rather
// than silently picking one.
const ACTIVE_PROSE_MODEL: StoryProseModelKey = "deepseekV4Pro";
// const ACTIVE_PROSE_MODEL: StoryProseModelKey = "kimiK3";
// const ACTIVE_PROSE_MODEL: StoryProseModelKey = "glm53";
// const ACTIVE_PROSE_MODEL: StoryProseModelKey = "mistralMedium35";

const PROSE_PROFILE: StoryProseModelProfile =
  STORY_PROSE_MODEL_PROFILES[ACTIVE_PROSE_MODEL];

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
    storyProseLogger.info("start", {
      action: ACTION_NAME,
      model: PROSE_PROFILE.model,
      storyId: parsedInput.story.id,
      chapterId: parsedInput.focusedChapter.id,
      approximateLength: parsedInput.approximateLength,
    });

    const manuscriptCharCount =
      getStoryProseManuscriptContextCharCount(parsedInput);

    if (manuscriptCharCount > STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT) {
      const routeError: StoryProseRouteError = {
        code: "MANUSCRIPT_CONTEXT_TOO_LARGE",
        message: buildManuscriptContextTooLargeMessage(),
        status: 413,
      };

      storyProseLogger.info("manuscript-context-too-large", {
        action: ACTION_NAME,
        storyId: parsedInput.story.id,
        chapterId: parsedInput.focusedChapter.id,
        approximateLength: parsedInput.approximateLength,
        manuscriptCharCount,
        manuscriptCharLimit: STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT,
      });
      logEnd(startedAt, parsedInput, "error", routeError.code);

      return errorResponse(routeError);
    }

    const settings = await getAppSettings();

    const systemPrompt = buildStoryProseSystemPrompt(
      settings.systemInstructions,
      parsedInput.story.systemInstructions,
    );
    const prosePrompt = buildStoryProsePrompt(parsedInput);
    const promptSnapshot = saveStoryProsePromptSnapshot({
      approximateLength: parsedInput.approximateLength,
      prompt: prosePrompt,
      regeneration: parsedInput.regeneration,
      system: systemPrompt,
    });
    const maxOutputTokens = getProseMaxOutputTokens(
      parsedInput.approximateLength,
    );

    const stream = streamLocalinkText({
      ...PROSE_PROFILE,
      temperature: getProseTemperature(parsedInput),
      system: systemPrompt,
      prompt: prosePrompt,
      abortSignal: request.signal,
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
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

function buildManuscriptContextTooLargeMessage(): string {
  return `The prose was not generated because this story is too large to send. This is a prompt-size guard, not a model failure. Distant chapters are already reduced to their summaries automatically, but the story still has to fit under about ${formatCharacterLimit(STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT)} characters of chapter text in total; split it into separate stories before trying again.`;
}

function getProseTemperature(input: StoryProseGenerationRequest): number {
  if (input.regeneration?.mode !== "fresh-alternative") {
    return PROSE_PROFILE.temperature;
  }

  return Math.min(
    PROSE_PROFILE.temperature + PROSE_FRESH_ALTERNATIVE_TEMPERATURE_BOOST,
    PROSE_MAX_TEMPERATURE,
  );
}

function getProseMaxOutputTokens(
  approximateLength: StoryProseGenerationRequest["approximateLength"],
): number | undefined {
  if (approximateLength === "unlimited") {
    return undefined;
  }

  return PROSE_MAX_OUTPUT_TOKENS_BY_LENGTH[approximateLength];
}

function formatCharacterLimit(limit: number): string {
  return limit.toLocaleString("en-US");
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
