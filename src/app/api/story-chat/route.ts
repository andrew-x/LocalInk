import { ActionError } from "@/lib/action-error";
import {
  isOpenRouterZdrUnavailableError,
  STORY_GENERATION_AI_MODELS,
} from "@/lib/ai";
import {
  LOCALINK_TEXT_STREAM_CONTENT_TYPE,
  LocalinkTextStreamFinishError,
} from "@/lib/ai-text-stream";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import { getAppSettings } from "@/lib/server/app-settings";
import {
  buildStoryChatGenerationMessages,
  buildStoryChatSystemPrompt,
} from "@/lib/server/story-chat";
import { createStoryChatGeneration } from "@/lib/server/story-chat-generation";
import {
  beginStoryChatGeneration,
  failStoryChatGeneration,
  finishStoryChatGeneration,
} from "@/lib/server/story-chat-staging";
import {
  type StoryChatStreamRequest,
  storyChatStreamRequestSchema,
} from "@/lib/story-chat-contract";
import type { StoryChatStreamEvent } from "@/lib/story-chat-stream";

export const runtime = "nodejs";

const storyChatLogger = createLogger("story-chat");
const ACTION_NAME = "story-chat-generate";

type StoryChatRouteError = {
  code:
    | "AI_NOT_CONFIGURED"
    | "AI_ZDR_UNAVAILABLE"
    | "BAD_REQUEST"
    | "GENERATION_FAILED"
    | "STREAM_OUTPUT_LIMIT"
    | "STREAM_CONTENT_FILTERED"
    | "STREAM_INCOMPLETE"
    | "STREAM_FAILED";
  message: string;
  status: number;
};

export async function POST(request: Request): Promise<Response> {
  const startedAt = day();
  let parsedInput: StoryChatStreamRequest | null = null;
  let attemptId: string | undefined;
  let cleanup = () => {};

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
      model: STORY_GENERATION_AI_MODELS[parsedInput.model],
      storyId: parsedInput.storyId,
      chatId: parsedInput.chatId,
      generationId: parsedInput.generationId,
      isRegeneration: Boolean(parsedInput.replaceAssistantMessageId),
    });

    const [settings, messages] = await Promise.all([
      getAppSettings(),
      buildStoryChatGenerationMessages(parsedInput),
    ]);

    attemptId = beginStoryChatGeneration(parsedInput);
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    cleanup = () => request.signal.removeEventListener("abort", abort);
    if (request.signal.aborted) abort();
    const generation = await createStoryChatGeneration({
      input: parsedInput,
      system: buildStoryChatSystemPrompt(settings.systemInstructions),
      messages,
      abortSignal: abortController.signal,
    });

    return toStoryChatResponse({
      generation,
      attemptId,
      input: parsedInput,
      startedAt,
      abortController,
      cleanup,
    });
  } catch (error) {
    cleanup();
    if (attemptId && parsedInput)
      failStoryChatGeneration(parsedInput, attemptId);
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
  if (error instanceof LocalinkTextStreamFinishError) {
    return { code: error.code, message: error.message, status: 500 };
  }

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

function toStoryChatResponse({
  generation,
  attemptId,
  input,
  startedAt,
  abortController,
  cleanup,
}: {
  generation: Awaited<ReturnType<typeof createStoryChatGeneration>>;
  attemptId: string;
  input: StoryChatStreamRequest;
  startedAt: ReturnType<typeof day>;
  abortController: AbortController;
  cleanup: () => void;
}): Response {
  const encoder = new TextEncoder();
  let canceled = false;
  let terminated = false;
  const abort = () => {
    abortController.abort();
    failStoryChatGeneration(input, attemptId);
    if (!terminated) logEnd(startedAt, input, "aborted");
    terminated = true;
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let content = "";
        let betweenSteps = false;
        const send = (event: StoryChatStreamEvent) => {
          if (!canceled)
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          for await (const part of generation.stream.fullStream) {
            if (canceled) return;
            if (abortController.signal.aborted || part.type === "abort") {
              abort();
              send({ type: "aborted" });
              return;
            }
            if (part.type === "text-delta") {
              if (betweenSteps && content && !content.endsWith("\n\n")) {
                content += "\n\n";
                send({ type: "delta", text: "\n\n" });
              }
              betweenSteps = false;
              content += part.text;
              send({ type: "delta", text: part.text });
            } else if (part.type === "tool-call") {
              send({
                type: "status",
                message:
                  part.toolName === "propose_manuscript_edits"
                    ? "Preparing manuscript edits…"
                    : "Reading manuscript…",
              });
            } else if (part.type === "error" || part.type === "tool-error") {
              throw part.error;
            } else if (part.type === "finish-step") {
              betweenSteps = true;
              if (
                part.finishReason !== "stop" &&
                part.finishReason !== "tool-calls"
              )
                throw new LocalinkTextStreamFinishError(part.finishReason);
            } else if (part.type === "finish") {
              if (part.finishReason !== "stop")
                throw new LocalinkTextStreamFinishError(part.finishReason);
              const proposal = generation.getProposal();
              if (!content.trim()) {
                if (!proposal) throw new LocalinkTextStreamFinishError();
                content = proposal.summary;
                send({ type: "delta", text: content });
              }
              finishStoryChatGeneration(input, attemptId, {
                content,
                proposal,
              });
              terminated = true;
              logEnd(startedAt, input, "complete");
              send({ type: "complete", finishReason: "stop" });
              return;
            }
          }
          throw new LocalinkTextStreamFinishError();
        } catch (error) {
          if (canceled) return;
          if (abortController.signal.aborted) {
            abort();
            send({ type: "aborted" });
            return;
          }
          failStoryChatGeneration(input, attemptId);
          const routeError = toRouteError(error);
          terminated = true;
          storyChatLogger.error("error", {
            action: ACTION_NAME,
            storyId: input.storyId,
            chatId: input.chatId,
            generationId: input.generationId,
            errorCode: routeError.code,
            errorName: getErrorName(error),
            durationMs: day().diff(startedAt),
          });
          logEnd(startedAt, input, "error", routeError.code);
          send({
            type: "error",
            code: routeError.code,
            message: routeError.message,
            finishReason:
              error instanceof LocalinkTextStreamFinishError
                ? error.finishReason
                : undefined,
          });
          abortController.abort();
        } finally {
          cleanup();
          if (!canceled) controller.close();
        }
      },
      cancel() {
        canceled = true;
        abort();
        cleanup();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": LOCALINK_TEXT_STREAM_CONTENT_TYPE,
      },
    },
  );
}
