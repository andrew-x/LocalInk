import { streamLocalinkText } from "@/lib/ai";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import { buildStoryProsePrompt } from "@/lib/server/story-prose-generation";
import { retrieveStoryProseContext } from "@/lib/server/story-prose-retrieval";
import {
  type StoryProseGenerationRequest,
  storyProseGenerationRequestSchema,
} from "@/lib/story-prose-generation-contract";

export const runtime = "nodejs";

const storyProseLogger = createLogger("story-prose");
const ACTION_NAME = "story-prose-generate";

type StoryProseRouteError = {
  code: "AI_NOT_CONFIGURED" | "BAD_REQUEST" | "GENERATION_FAILED";
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

    const retrievalResult = await retrieveStoryProseContext(parsedInput);

    storyProseLogger.info("retrieval", {
      action: ACTION_NAME,
      storyId: parsedInput.story.id,
      chapterId: parsedInput.focusedChapter.id,
      eligibleChunkCount: retrievalResult.eligibleChunkCount,
      bm25RankedCount: retrievalResult.bm25RankedCount,
      vectorRankedCount: retrievalResult.vectorRankedCount,
      mergedRankedCount: retrievalResult.mergedRankedCount,
      selectedChunkCount: retrievalResult.chunks.length,
    });

    const stream = streamLocalinkText({
      model: "main",
      prompt: buildStoryProsePrompt(parsedInput, {
        retrievedChunks: retrievalResult.chunks,
      }),
      abortSignal: request.signal,
      temperature: 0.82,
      onAbort: () => {
        logEnd(startedAt, parsedInput, "aborted");
      },
      onError: ({ error }) => {
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
      },
      onFinish: () => {
        logEnd(startedAt, parsedInput, "complete");
      },
    });

    return stream.toTextStreamResponse({
      headers: {
        "Cache-Control": "no-store",
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

function errorResponse(error: StoryProseRouteError): Response {
  return Response.json(
    {
      code: error.code,
      message: error.message,
    },
    { status: error.status },
  );
}
