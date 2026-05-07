export const LOCALINK_TEXT_STREAM_CONTENT_TYPE =
  "application/x-ndjson; charset=utf-8";

export type LocalinkTextStreamEvent =
  | {
      text: string;
      type: "delta";
    }
  | {
      type: "complete";
    }
  | {
      code: string;
      message: string;
      type: "error";
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

    if (!trimmedLine) {
      return;
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

    throw new LocalinkTextStreamError(event.code, event.message);
  }

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bufferedText += decoder.decode(value, { stream: true });

    const lines = bufferedText.split("\n");
    bufferedText = lines.pop() ?? "";

    for (const line of lines) {
      handleLine(line);
    }
  }

  bufferedText += decoder.decode();

  if (bufferedText.trim()) {
    handleLine(bufferedText);
  }

  if (!didComplete) {
    throw new LocalinkTextStreamError("STREAM_INCOMPLETE", incompleteMessage);
  }
}

function parseLocalinkTextStreamEvent(line: string): LocalinkTextStreamEvent {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch {
    throw new LocalinkTextStreamError(
      "STREAM_INVALID",
      "The generation stream returned invalid data.",
    );
  }

  if (!value || typeof value !== "object") {
    throw new LocalinkTextStreamError(
      "STREAM_INVALID",
      "The generation stream returned invalid data.",
    );
  }

  const event = value as Partial<LocalinkTextStreamEvent>;

  if (event.type === "delta" && typeof event.text === "string") {
    return event as LocalinkTextStreamEvent;
  }

  if (event.type === "complete") {
    return event as LocalinkTextStreamEvent;
  }

  if (
    event.type === "error" &&
    typeof event.code === "string" &&
    typeof event.message === "string"
  ) {
    return event as LocalinkTextStreamEvent;
  }

  throw new LocalinkTextStreamError(
    "STREAM_INVALID",
    "The generation stream returned invalid data.",
  );
}
