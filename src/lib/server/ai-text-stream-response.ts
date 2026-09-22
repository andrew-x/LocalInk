import "server-only";

import {
  encodeLocalinkTextStreamEvent,
  LOCALINK_TEXT_STREAM_CONTENT_TYPE,
  LocalinkTextStreamFinishError,
} from "@/lib/ai-text-stream";

type LocalinkTextStreamPart = {
  error?: unknown;
  finishReason?: string;
  text?: string;
  type: string;
};

type LocalinkTextStreamRouteError = {
  code: string;
  message: string;
};

type LocalinkTextStreamResponseOptions<
  TRouteError extends LocalinkTextStreamRouteError,
> = {
  headers?: HeadersInit;
  onAbort: () => void;
  onComplete: () => void;
  onError: (error: unknown, routeError: TRouteError) => void;
  requestSignal?: AbortSignal;
  stream: {
    fullStream: AsyncIterable<LocalinkTextStreamPart>;
  };
  toRouteError: (error: unknown) => TRouteError;
};

export function toLocalinkTextStreamResponse<
  TRouteError extends LocalinkTextStreamRouteError,
>({
  headers,
  onAbort,
  onComplete,
  onError,
  requestSignal,
  stream,
  toRouteError,
}: LocalinkTextStreamResponseOptions<TRouteError>): Response {
  const encoder = new TextEncoder();
  let canceled = false;
  let didTerminate = false;

  function reportAbort() {
    if (didTerminate) return;
    didTerminate = true;
    onAbort();
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (
          event: Parameters<typeof encodeLocalinkTextStreamEvent>[0],
        ) => {
          if (!canceled) {
            controller.enqueue(
              encoder.encode(encodeLocalinkTextStreamEvent(event)),
            );
          }
        };
        const sendError = (error: unknown) => {
          const routeError = toRouteError(error);
          didTerminate = true;
          onError(error, routeError);
          sendEvent({
            code: routeError.code,
            finishReason:
              error instanceof LocalinkTextStreamFinishError
                ? error.finishReason
                : undefined,
            message: routeError.message,
            type: "error",
          });
        };
        const sendAbort = () => {
          reportAbort();
          sendEvent({ type: "aborted" });
        };

        try {
          for await (const part of stream.fullStream) {
            if (canceled) return;
            if (requestSignal?.aborted) {
              sendAbort();
              return;
            }

            if (part.type === "text-delta" && typeof part.text === "string") {
              sendEvent({ text: part.text, type: "delta" });
              continue;
            }

            if (part.type === "error") {
              sendError(part.error);
              return;
            }

            if (part.type === "finish") {
              if (part.finishReason !== "stop") {
                sendError(new LocalinkTextStreamFinishError(part.finishReason));
                return;
              }

              didTerminate = true;
              onComplete();
              sendEvent({ finishReason: "stop", type: "complete" });
              return;
            }

            if (part.type === "abort") {
              sendAbort();
              return;
            }
          }

          if (canceled) return;
          if (requestSignal?.aborted) {
            sendAbort();
            return;
          }
          sendError(new LocalinkTextStreamFinishError());
        } catch (error) {
          if (canceled) return;
          if (requestSignal?.aborted) {
            sendAbort();
            return;
          }

          sendError(error);
        } finally {
          if (!canceled) controller.close();
        }
      },
      cancel() {
        canceled = true;
        reportAbort();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": LOCALINK_TEXT_STREAM_CONTENT_TYPE,
        ...headers,
      },
    },
  );
}
