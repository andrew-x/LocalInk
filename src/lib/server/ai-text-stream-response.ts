import "server-only";

import {
  encodeLocalinkTextStreamEvent,
  LOCALINK_TEXT_STREAM_CONTENT_TYPE,
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

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendEvent = (
          event: Parameters<typeof encodeLocalinkTextStreamEvent>[0],
        ) => {
          controller.enqueue(
            encoder.encode(encodeLocalinkTextStreamEvent(event)),
          );
        };

        try {
          for await (const part of stream.fullStream) {
            if (part.type === "text-delta" && typeof part.text === "string") {
              sendEvent({ text: part.text, type: "delta" });
              continue;
            }

            if (part.type === "error") {
              const routeError = toRouteError(part.error);

              onError(part.error, routeError);
              sendEvent({
                code: routeError.code,
                message: routeError.message,
                type: "error",
              });
              return;
            }

            if (part.type === "finish") {
              if (part.finishReason === "error") {
                const error = new Error("AI stream finished with an error.");
                const routeError = toRouteError(error);

                onError(error, routeError);
                sendEvent({
                  code: routeError.code,
                  message: routeError.message,
                  type: "error",
                });
                return;
              }

              onComplete();
              sendEvent({ type: "complete" });
              return;
            }

            if (part.type === "abort") {
              onAbort();
              return;
            }
          }

          const error = new Error("AI stream ended before completion.");
          const routeError = toRouteError(error);

          onError(error, routeError);
          sendEvent({
            code: routeError.code,
            message: routeError.message,
            type: "error",
          });
        } catch (error) {
          if (requestSignal?.aborted) {
            onAbort();
            return;
          }

          const routeError = toRouteError(error);

          onError(error, routeError);
          sendEvent({
            code: routeError.code,
            message: routeError.message,
            type: "error",
          });
        } finally {
          controller.close();
        }
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
