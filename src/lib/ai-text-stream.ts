export const LOCALINK_TEXT_STREAM_CONTENT_TYPE =
  "application/x-ndjson; charset=utf-8";

export type LocalinkTextStreamFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other"
  | "unknown";

export type LocalinkTextStreamEvent =
  | {
      text: string;
      type: "delta";
    }
  | {
      finishReason: "stop";
      type: "complete";
    }
  | {
      code: string;
      finishReason?: LocalinkTextStreamFinishReason;
      message: string;
      type: "error";
    }
  | {
      type: "aborted";
    };

export type LocalinkTextStreamReadOptions = {
  incompleteMessage: string;
  onDelta: (text: string) => void;
  unavailableMessage: string;
};

export class LocalinkTextStreamError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LocalinkTextStreamError";
    this.code = code;
  }
}

export type LocalinkTextStreamFinishErrorCode =
  | "STREAM_OUTPUT_LIMIT"
  | "STREAM_CONTENT_FILTERED"
  | "STREAM_FAILED"
  | "STREAM_INCOMPLETE";

export class LocalinkTextStreamFinishError extends LocalinkTextStreamError {
  declare readonly code: LocalinkTextStreamFinishErrorCode;
  readonly finishReason: LocalinkTextStreamFinishReason | undefined;

  constructor(finishReason?: string, message?: string) {
    const reason = normalizeLocalinkTextStreamFinishReason(finishReason);
    const [code, defaultMessage]: [LocalinkTextStreamFinishErrorCode, string] =
      reason === "length"
        ? [
            "STREAM_OUTPUT_LIMIT",
            "Generation reached its output limit before finishing.",
          ]
        : reason === "content-filter"
          ? [
              "STREAM_CONTENT_FILTERED",
              "Generation was interrupted by the provider's content filter.",
            ]
          : reason === "error"
            ? ["STREAM_FAILED", "Generation failed before it could finish."]
            : ["STREAM_INCOMPLETE", "Generation ended before completion."];

    super(code, message ?? defaultMessage);
    this.name = "LocalinkTextStreamFinishError";
    this.finishReason = reason;
  }
}

export function isLocalinkIncompleteFinish(error: unknown): boolean {
  return (
    error instanceof LocalinkTextStreamError &&
    (error.code === "STREAM_OUTPUT_LIMIT" ||
      error.code === "STREAM_CONTENT_FILTERED" ||
      error.code === "STREAM_INCOMPLETE")
  );
}

export function normalizeLocalinkTextStreamFinishReason(
  reason: string | undefined,
): LocalinkTextStreamFinishReason | undefined {
  if (reason === undefined) return undefined;

  switch (reason) {
    case "stop":
    case "length":
    case "content-filter":
    case "tool-calls":
    case "error":
    case "other":
    case "unknown":
      return reason;
    default:
      return "unknown";
  }
}

export function encodeLocalinkTextStreamEvent(
  event: LocalinkTextStreamEvent,
): string {
  return `${JSON.stringify(event)}\n`;
}

export async function readLocalinkTextStream(
  response: Response,
  {
    incompleteMessage,
    onDelta,
    unavailableMessage,
  }: LocalinkTextStreamReadOptions,
): Promise<void> {
  if (!response.body) {
    throw new LocalinkTextStreamError("STREAM_UNAVAILABLE", unavailableMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";
  let didComplete = false;

  function handleLine(line: string) {
    const trimmedLine = line.trim();

    if (!trimmedLine) return;

    if (didComplete) {
      throw new LocalinkTextStreamError(
        "STREAM_INVALID",
        "The generation stream returned data after completion.",
      );
    }

    const event = parseLocalinkTextStreamEvent(trimmedLine);

    if (event.type === "delta") {
      onDelta(event.text);
      return;
    }

    if (event.type === "complete") {
      didComplete = true;
      return;
    }

    if (event.type === "aborted") {
      throw new LocalinkTextStreamError(
        "STREAM_ABORTED",
        "Generation was stopped.",
      );
    }

    if (
      event.finishReason !== undefined ||
      event.code === "STREAM_INCOMPLETE"
    ) {
      throw new LocalinkTextStreamFinishError(
        event.finishReason,
        event.message,
      );
    }

    throw new LocalinkTextStreamError(event.code, event.message);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bufferedText += decoder.decode(value, { stream: true });

      const lines = bufferedText.split("\n");
      bufferedText = lines.pop() ?? "";

      for (const line of lines) handleLine(line);
    }

    bufferedText += decoder.decode();

    if (bufferedText.trim()) handleLine(bufferedText);

    if (!didComplete) {
      throw new LocalinkTextStreamFinishError(undefined, incompleteMessage);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function parseLocalinkTextStreamEvent(line: string): LocalinkTextStreamEvent {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    throw invalidStreamError();
  }

  if (!value || typeof value !== "object") throw invalidStreamError();

  const event = value as Partial<LocalinkTextStreamEvent>;

  if (event.type === "delta" && typeof event.text === "string") {
    return event as LocalinkTextStreamEvent;
  }

  if (event.type === "complete" && event.finishReason === "stop") {
    return event as LocalinkTextStreamEvent;
  }

  if (event.type === "aborted") return event as LocalinkTextStreamEvent;

  if (
    event.type === "error" &&
    typeof event.code === "string" &&
    typeof event.message === "string" &&
    (event.finishReason === undefined ||
      (typeof event.finishReason === "string" && event.finishReason !== "stop"))
  ) {
    return {
      ...event,
      finishReason: normalizeLocalinkTextStreamFinishReason(event.finishReason),
    } as LocalinkTextStreamEvent;
  }

  throw invalidStreamError();
}

function invalidStreamError() {
  return new LocalinkTextStreamError(
    "STREAM_INVALID",
    "The generation stream returned invalid data.",
  );
}
