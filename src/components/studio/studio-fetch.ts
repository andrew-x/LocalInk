import {
  LocalinkTextStreamError,
  readLocalinkTextStream,
} from "@/lib/ai-text-stream";

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

async function readRouteErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string" &&
      body.message.trim()
    ) {
      return body.message;
    }
  } catch {
    // Fall through to the generic message.
  }
  return GENERIC_ERROR_MESSAGE;
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
    throw new Error(await readRouteErrorMessage(response));
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(GENERIC_ERROR_MESSAGE);
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

  if (!response.ok) {
    throw new LocalinkTextStreamError(
      "STUDIO_REQUEST_FAILED",
      await readRouteErrorMessage(response),
    );
  }

  await readLocalinkTextStream(response, {
    incompleteMessage: "The draft stopped before it finished.",
    onDelta,
    unavailableMessage: "The draft could not be started.",
  });
}
