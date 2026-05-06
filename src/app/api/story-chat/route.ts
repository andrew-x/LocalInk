import { ActionError } from "@/lib/action-error";
import { streamLocalinkText } from "@/lib/ai";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import {
  buildStoryChatGenerationMessages,
  buildStoryChatSystemPrompt,
} from "@/lib/server/story-chat";
import {
  type StoryChatStreamRequest,
  storyChatStreamRequestSchema,
} from "@/lib/story-chat-contract";

export const runtime = "nodejs";

const storyChatLogger = createLogger("story-chat");
const ACTION_NAME = "story-chat-generate";

type StoryChatRouteError = {
  code: "AI_NOT_CONFIGURED" | "BAD_REQUEST" | "GENERATION_FAILED";
  message: string;
  status: number;
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = day();
  let parsedInput: StoryChatStreamRequest | null = null;

  try {
    const body = await request.json();
    const result = storyChatStreamRequestSchema.safeParse(body);

    if (!result.success) {
      const routeError: StoryChatRouteError = {
        code: "BAD_REQUEST",
        message: "The chat generation request is invalid.",
        status: 400,
      };

      storyChatLogger.info("end", {
        action: ACTION_NAME,
        errorCode: routeError.code,
        success: false,
        durationMs: day().diff(startedAt),
      });

      return errorResponse(routeError);
    }

    parsedInput = result.data;
    storyChatLogger.info("start", {
      action: ACTION_NAME,
      storyId: parsedInput.storyId,
      chatId: parsedInput.chatId,
      generationId: parsedInput.generationId,
      isRegeneration: Boolean(parsedInput.replaceAssistantMessageId),
    });

    const stream = streamLocalinkText({
      model: "main",
      system: buildStoryChatSystemPrompt(),
      messages: await buildStoryChatGenerationMessages(parsedInput),
      abortSignal: request.signal,
      temperature: 0.72,
      onAbort: () => {
        logEnd(startedAt, parsedInput, "aborted");
      },
      onError: ({ error }) => {
        const routeError = toRouteError(error);

        storyChatLogger.error("error", {
          action: ACTION_NAME,
          storyId: parsedInput?.storyId,
          chatId: parsedInput?.chatId,
          generationId: parsedInput?.generationId,
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

    storyChatLogger.error("error", {
      action: ACTION_NAME,
      storyId: parsedInput?.storyId,
      chatId: parsedInput?.chatId,
      generationId: parsedInput?.generationId,
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
  input: StoryChatStreamRequest | null,
  status: "aborted" | "complete" | "error",
  errorCode?: StoryChatRouteError["code"],
) {
  storyChatLogger.info("end", {
    action: ACTION_NAME,
    storyId: input?.storyId,
    chatId: input?.chatId,
    generationId: input?.generationId,
    status,
    errorCode,
    success: status === "complete",
    durationMs: day().diff(startedAt),
  });
}

function toRouteError(error: unknown): StoryChatRouteError {
  if (error instanceof ActionError && error.code === "BAD_REQUEST") {
    return {
      code: "BAD_REQUEST",
      message: error.publicMessage,
      status: 400,
    };
  }

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
    message: "The chat reply could not be generated.",
    status: 500,
  };
}

function isMissingOpenRouterApiKeyError(error: unknown) {
  return error instanceof Error && error.message.includes("OPENROUTER_API_KEY");
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorResponse(error: StoryChatRouteError): Response {
  return Response.json(
    {
      code: error.code,
      message: error.message,
    },
    { status: error.status },
  );
}
