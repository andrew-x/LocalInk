import { createSafeActionClient, isNavigationError } from "next-safe-action";
import { z } from "zod";

import { ActionError, type ActionErrorCode } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { createLogger } from "@/lib/logger";
import { IS_MAINTENANCE_MODE } from "@/lib/util";

const actionMetadataSchema = z.object({
  action: z.string().min(1),
});

export type ActionMetadata = z.infer<typeof actionMetadataSchema>;

export type ActionServerError = {
  code: ActionErrorCode;
  message: string;
};

type ActionLogEndDetails = {
  errorCode?: ActionErrorCode;
  success: boolean;
};

type ActionLogErrorDetails = {
  code: ActionErrorCode;
  errorMessage: string;
};

const actionLogger = createLogger("action");

const baseActionClient = createSafeActionClient({
  defineMetadataSchema() {
    return actionMetadataSchema;
  },
  defaultValidationErrorsShape: "flattened",
  handleServerError(error, utils): ActionServerError {
    if (isNavigationError(error)) {
      throw error;
    }

    const serverError = toActionServerError(error);

    actionLogger.error("error", {
      action: utils.metadata?.action,
      code: serverError.code,
      error,
      errorMessage: getErrorMessage(error),
    });

    return serverError;
  },
});

export const publicActionClient = baseActionClient
  .use(async ({ next, metadata }) => {
    const actionLog = startActionLog(metadata.action);

    try {
      const result = await next();

      actionLog.end({
        errorCode: result.serverError?.code,
        success: result.success,
      });

      return result;
    } catch (error) {
      if (isNavigationError(error)) {
        throw error;
      }

      logActionError(actionLog, error);

      throw error;
    }
  })
  .use(async ({ next }) => {
    if (IS_MAINTENANCE_MODE) {
      throw new ActionError(
        "MAINTENANCE",
        "LocalInk is currently in maintenance mode.",
      );
    }

    return next();
  });

export async function runLoggedAction<TResult>(
  metadata: ActionMetadata,
  handler: () => Promise<TResult>,
): Promise<TResult> {
  const { action } = actionMetadataSchema.parse(metadata);
  const actionLog = startActionLog(action);

  try {
    const result = await handler();

    actionLog.end({ success: true });

    return result;
  } catch (error) {
    if (isNavigationError(error)) {
      throw error;
    }

    logActionError(actionLog, error);

    throw error;
  }
}

function startActionLog(action: string) {
  const startedAt = day();

  actionLogger.info("start", {
    action,
  });

  return {
    end(details: ActionLogEndDetails) {
      actionLogger.info("end", {
        action,
        ...details,
        durationMs: day().diff(startedAt),
      });
    },
    error(error: unknown, details: ActionLogErrorDetails) {
      actionLogger.error("error", {
        action,
        ...details,
        error,
        durationMs: day().diff(startedAt),
      });
    },
  };
}

function logActionError(
  actionLog: ReturnType<typeof startActionLog>,
  error: unknown,
) {
  const serverError = toActionServerError(error);

  actionLog.error(error, {
    code: serverError.code,
    errorMessage: getErrorMessage(error),
  });
  actionLog.end({
    errorCode: serverError.code,
    success: false,
  });
}

function toActionServerError(error: unknown): ActionServerError {
  if (error instanceof ActionError) {
    return {
      code: error.code,
      message: error.publicMessage,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Something went wrong while running this action.",
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "A non-Error value was thrown.";
}
