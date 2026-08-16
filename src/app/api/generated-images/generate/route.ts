import type { GeneratedImageDetail } from "@/actions/generated-images/_types";
import { runLoggedAction } from "@/lib/action";
import { ActionError, type ActionErrorCode } from "@/lib/action-error";
import {
  type GenerateImageRouteError,
  generateImageRequestSchema,
} from "@/lib/generated-image-generation-contract";
import { generateAndStoreGeneratedImage } from "@/lib/server/generated-images";
import { IS_MAINTENANCE_MODE } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTION_NAME = "generate-image";

const STATUS_BY_ERROR_CODE: Record<ActionErrorCode, number> = {
  AI_NOT_CONFIGURED: 503,
  AI_ZDR_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  GENERATION_FAILED: 500,
  INTERNAL_ERROR: 500,
  MAINTENANCE: 503,
};

/**
 * Generation lives in a Route Handler, not a Server Action, because Next
 * dispatches Server Actions one at a time per client and the workspace runs
 * several generations concurrently. Everything `publicActionClient` enforces is
 * reproduced here: the shared Zod schema, `runLoggedAction` metadata logging,
 * the maintenance gate, and `ActionError` code/message passthrough.
 *
 * No `revalidatePath("/images")`: the gallery page calls `connection()`, so it
 * is fully dynamic and renders per request already.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = generateImageRequestSchema.safeParse(body);

  if (!parsed.success) {
    return errorResponse({
      code: "BAD_REQUEST",
      message:
        parsed.error.issues[0]?.message ??
        "The image generation request is invalid.",
    });
  }

  try {
    const image = await runLoggedAction<GeneratedImageDetail>(
      { action: ACTION_NAME },
      () => {
        if (IS_MAINTENANCE_MODE) {
          throw new ActionError(
            "MAINTENANCE",
            "LocalInk is currently in maintenance mode.",
          );
        }

        return generateAndStoreGeneratedImage(parsed.data);
      },
    );

    return Response.json(image);
  } catch (error) {
    // The client hung up. It cannot read a body, and this is not a failure.
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    return errorResponse(toRouteError(error));
  }
}

/**
 * `generateAndStoreGeneratedImage` already logs sanitized failure detail via
 * `logGeneratedImageFailure`, so nothing here re-reads the provider body.
 */
function toRouteError(error: unknown): GenerateImageRouteError {
  if (error instanceof ActionError) {
    return { code: error.code, message: error.publicMessage };
  }

  return {
    code: "GENERATION_FAILED",
    message: "The image could not be generated.",
  };
}

function errorResponse(error: GenerateImageRouteError): Response {
  return Response.json(error, { status: STATUS_BY_ERROR_CODE[error.code] });
}
