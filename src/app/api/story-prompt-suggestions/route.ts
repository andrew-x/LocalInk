import { runLoggedAction } from "@/lib/action";
import { ActionError, type ActionErrorCode } from "@/lib/action-error";
import {
  generateStoryPromptSuggestions,
  StoryPromptContextTooLargeError,
} from "@/lib/server/story-prompt-suggestions";
import { storyPromptSuggestionsRequestSchema } from "@/lib/story-prompt-suggestions-contract";
import { IS_MAINTENANCE_MODE } from "@/lib/util";

export const runtime = "nodejs";

const STATUS_BY_ERROR_CODE: Record<ActionErrorCode, number> = {
  AI_NOT_CONFIGURED: 503,
  AI_ZDR_UNAVAILABLE: 503,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  GENERATION_FAILED: 500,
  INTERNAL_ERROR: 500,
  MAINTENANCE: 503,
};

/** Non-persisting generation uses a cancellable request with the read boundary. */
export async function POST(request: Request): Promise<Response> {
  try {
    const output = await runLoggedAction(
      { action: "story-prompt-suggestions" },
      async () => {
        request.signal.throwIfAborted();
        if (IS_MAINTENANCE_MODE) {
          throw new ActionError(
            "MAINTENANCE",
            "LocalInk is currently in maintenance mode.",
          );
        }
        const body = await request.json().catch(() => null);
        const parsed = storyPromptSuggestionsRequestSchema.safeParse(body);
        if (!parsed.success) {
          throw new ActionError(
            "BAD_REQUEST",
            "The story prompt suggestion request is invalid.",
          );
        }
        return generateStoryPromptSuggestions(parsed.data, request.signal);
      },
    );
    return Response.json(output);
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof StoryPromptContextTooLargeError) {
      return Response.json(
        {
          code: "MANUSCRIPT_CONTEXT_TOO_LARGE",
          message: error.publicMessage,
        },
        { status: 413 },
      );
    }
    const publicError =
      error instanceof ActionError
        ? error
        : new ActionError(
            "GENERATION_FAILED",
            "The story prompt suggestion could not be generated. Try again.",
          );
    return Response.json(
      { code: publicError.code, message: publicError.publicMessage },
      { status: STATUS_BY_ERROR_CODE[publicError.code] },
    );
  }
}
