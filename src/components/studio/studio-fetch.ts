import {
  LocalinkTextStreamError,
  readLocalinkTextStream,
} from "@/lib/ai-text-stream";

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** A failed Studio route call. Its message is already sanitized for the author. */
export class StudioRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioRequestError";
  }
}

/**
 * The message to toast for a failed Studio request: a route's own sanitized
 * message when there is one, otherwise `fallback`. Network and unknown errors
 * never surface their raw text.
 */
export function studioErrorMessage(error: unknown, fallback: string): string {
  if (
    (error instanceof StudioRequestError ||
      error instanceof LocalinkTextStreamError) &&
    error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

/** A refused Studio route's `{ code, message }`; the message is sanitized or generic. */
async function readRouteError(
  response: Response,
): Promise<{ code: string | null; message: string }> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const code =
        "code" in body && typeof body.code === "string" ? body.code : null;
      const message =
        "message" in body &&
        typeof body.message === "string" &&
        body.message.trim()
          ? body.message
          : GENERIC_ERROR_MESSAGE;
      return { code, message };
    }
  } catch {
    // Fall through to the generic message.
  }
  return { code: null, message: GENERIC_ERROR_MESSAGE };
}

/** A refused Studio route's sanitized `{ message }`, or a generic message. */
export async function readRouteErrorMessage(
  response: Response,
): Promise<string> {
  return (await readRouteError(response)).message;
}

export async function postStudioJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new StudioRequestError(await readRouteErrorMessage(response));
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new StudioRequestError(GENERIC_ERROR_MESSAGE);
  }
}

export async function streamStudioText(
  path: string,
  body: unknown,
  {
    onDelta,
    signal,
  }: { onDelta: (text: string) => void; signal?: AbortSignal },
): Promise<void> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal,
  });

  // The route's code (e.g. DRAFT_EXPIRED) rides along so callers can react to it.
  if (!response.ok) {
    const { code, message } = await readRouteError(response);
    throw new LocalinkTextStreamError(code ?? "STUDIO_REQUEST_FAILED", message);
  }

  await readLocalinkTextStream(response, {
    incompleteMessage: "The draft stopped before it finished.",
    onDelta,
    unavailableMessage: "The draft could not be started.",
  });
}
