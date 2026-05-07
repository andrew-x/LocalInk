import { type LocalinkProviderOptions, streamLocalinkText } from "@/lib/ai";
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
} satisfies Record<StoryProseGenerationRequest["approximateLength"], number>;
const PROSE_PROVIDER_OPTIONS = {
  openrouter: {
    reasoning: {
      effort: "none",
      exclude: true,
    },
  },
} satisfies LocalinkProviderOptions;

type StoryProseRouteError = {
  code:
    | "AI_NOT_CONFIGURED"
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
    );
    const prosePrompt = buildStoryProsePrompt(parsedInput);
    const promptSnapshot = saveStoryProsePromptSnapshot({
      approximateLength: parsedInput.approximateLength,
      prompt: prosePrompt,
      regeneration: parsedInput.regeneration,
      system: systemPrompt,
    });

    const stream = streamLocalinkText({
      model: "main",
      system: systemPrompt,
      prompt: prosePrompt,
      abortSignal: request.signal,
      maxOutputTokens:
        PROSE_MAX_OUTPUT_TOKENS_BY_LENGTH[parsedInput.approximateLength],
      providerOptions: PROSE_PROVIDER_OPTIONS,
      temperature: 0.82,
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
  return `The prose was not generated because this story is too large for full-manuscript context. This is a prompt-size guard, not a model failure. Full-manuscript generation currently supports about ${formatCharacterLimit(STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT)} characters of chapter text; reduce or split the manuscript before trying again.`;
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
