import {
  LocalinkTextStreamError,
  type LocalinkTextStreamEvent,
  LocalinkTextStreamFinishError,
} from "@/lib/ai-text-stream";

export type StoryChatStreamEvent =
  | LocalinkTextStreamEvent
  | { type: "status"; message: string };

/** Chat has tool progress events; prose retains its stricter text-only protocol. */
export async function readStoryChatStream(
  response: Response,
  {
    onDelta,
    onStatus,
    incompleteMessage = "The chat reply ended before completion.",
    unavailableMessage = "The chat reply stream is unavailable.",
  }: {
    onDelta: (text: string) => void;
    onStatus?: (message: string) => void;
    incompleteMessage?: string;
    unavailableMessage?: string;
  },
): Promise<void> {
  if (!response.body) {
    throw new LocalinkTextStreamError("STREAM_UNAVAILABLE", unavailableMessage);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let complete = false;
  const invalid = () =>
    new LocalinkTextStreamError(
      "STREAM_INVALID",
      "The chat stream returned invalid data.",
    );
  const handle = (line: string) => {
    if (!line.trim()) return;
    if (complete) throw invalid();
    let event: Partial<StoryChatStreamEvent>;
    try {
      event = JSON.parse(line);
    } catch {
      throw invalid();
    }
    if (!event || typeof event !== "object") throw invalid();
    if (event.type === "delta" && typeof event.text === "string") {
      onDelta(event.text);
    } else if (event.type === "status" && typeof event.message === "string") {
      onStatus?.(event.message);
    } else if (event.type === "complete" && event.finishReason === "stop") {
      complete = true;
    } else if (event.type === "aborted") {
      throw new LocalinkTextStreamError(
        "STREAM_ABORTED",
        "Generation was stopped.",
      );
    } else if (
      event.type === "error" &&
      typeof event.code === "string" &&
      typeof event.message === "string"
    ) {
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
    } else {
      throw invalid();
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
      if (buffer.length > 1_000_000) throw invalid();
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(buffer);
    if (!complete)
      throw new LocalinkTextStreamFinishError(undefined, incompleteMessage);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
