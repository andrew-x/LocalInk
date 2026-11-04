import "server-only";

import { ActionError } from "@/lib/action-error";
import { isAiConfigurationError } from "@/lib/ai";
import {
  LocalinkTextStreamFinishError,
  type LocalinkTextStreamFinishErrorCode,
} from "@/lib/ai-text-stream";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";

import {
  StudioBadRequestError,
  StudioContextTooLargeError,
  StudioDraftExpiredError,
  StudioNotFoundError,
} from "./prompt-kit";

export type StudioRouteErrorCode =
  | "AI_NOT_CONFIGURED"
  | "BAD_REQUEST"
  | "DRAFT_EXPIRED"
  | "GENERATION_FAILED"
  | "STUDIO_CONTEXT_TOO_LARGE"
  | "STUDIO_NOT_FOUND"
  | LocalinkTextStreamFinishErrorCode;

export type StudioRouteError = {
  code: StudioRouteErrorCode;
  message: string;
  status: number;
};

const AI_NOT_CONFIGURED_MESSAGE =
  "AI generation is not configured. Check the API key for the selected model’s provider and try again.";

export function toStudioRouteError(error: unknown): StudioRouteError {
  if (error instanceof StudioContextTooLargeError) {
    return {
      code: "STUDIO_CONTEXT_TOO_LARGE",
      message: error.message,
      status: 413,
    };
  }
  if (error instanceof StudioNotFoundError) {
    return {
      code: "STUDIO_NOT_FOUND",
      message: "This story or moment no longer exists.",
      status: 404,
    };
  }
  if (error instanceof StudioDraftExpiredError) {
    return {
      code: "DRAFT_EXPIRED",
      message:
        "An earlier part of this draft is no longer available. Redo it, then continue.",
      status: 409,
    };
  }
  if (error instanceof StudioBadRequestError) {
    return { code: "BAD_REQUEST", message: error.message, status: 400 };
  }
  if (error instanceof LocalinkTextStreamFinishError) {
    return { code: error.code, message: error.message, status: 500 };
  }
  if (isAiConfigurationError(error)) {
    return {
      code: "AI_NOT_CONFIGURED",
      message: AI_NOT_CONFIGURED_MESSAGE,
      status: 503,
    };
  }
  // Staging errors carry a public message written for the author.
  if (error instanceof ActionError) {
    if (error.code === "BAD_REQUEST") {
      return { code: "BAD_REQUEST", message: error.publicMessage, status: 400 };
    }
    if (error.code === "GENERATION_FAILED") {
      return {
        code: "GENERATION_FAILED",
        message: error.publicMessage,
        status: 500,
      };
    }
  }
  return {
    code: "GENERATION_FAILED",
    message: "The generation could not be completed. Try again.",
    status: 500,
  };
}

export function studioErrorResponse(error: StudioRouteError): Response {
  return Response.json(
    { code: error.code, message: error.message },
    { status: error.status },
  );
}

const studioRouteLogger = createLogger("studio-route");

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * Operational logging only: action name, ids, counts, durations, and sanitized
 * codes. `ids` is read at log time, so a route may fill it in after parsing
 * the body. Never put prompts, Bible text, or prose in `ids` or `details`.
 */
export function createStudioRouteLog(
  action: string,
  ids: Record<string, string | undefined>,
) {
  const startedAt = day();
  const durationMs = () => day().diff(startedAt);
  return {
    start(details?: Record<string, unknown>) {
      studioRouteLogger.info("start", { action, ...ids, ...details });
    },
    end(
      status: "complete" | "aborted" | "error",
      errorCode?: string,
      details?: Record<string, number | boolean | string | undefined>,
    ) {
      studioRouteLogger.info("end", {
        action,
        ...ids,
        ...details,
        status,
        errorCode,
        success: status === "complete",
        durationMs: durationMs(),
      });
    },
    error(error: unknown, routeError: StudioRouteError) {
      studioRouteLogger.error("error", {
        action,
        ...ids,
        errorCode: routeError.code,
        errorName: errorName(error),
        durationMs: durationMs(),
      });
    },
  };
}

type StageablePart = { type: string; text?: string; finishReason?: string };

/**
 * Re-yields every stream part. Accumulated text is handed to `onStopText`
 * synchronously before a normal `finish` part is yielded, so a staged result
 * already exists by the time the client sees completion.
 */
export async function* stageOnStop<TPart extends StageablePart>(
  fullStream: AsyncIterable<TPart>,
  onStopText: (text: string) => void,
): AsyncGenerator<TPart> {
  let accumulated = "";
  for await (const part of fullStream) {
    if (part.type === "text-delta" && typeof part.text === "string") {
      accumulated += part.text;
    } else if (part.type === "finish" && part.finishReason === "stop") {
      onStopText(accumulated);
    }
    yield part;
  }
}
