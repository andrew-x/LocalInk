import { z } from "zod";

import {
  LocalinkTextStreamError,
  LocalinkTextStreamFinishError,
  type LocalinkTextStreamFinishReason,
} from "@/lib/ai-text-stream";
import type { StudioBundleDto } from "@/lib/studio/bundle-contract";

/**
 * The Studio agent chat contract, shared by the route, the actions, and the
 * client. A turn is: `prepareStudioChatTurn` (stores the user message and
 * returns a generationId) → POST /api/studio/chat (streams NDJSON events and
 * stages the reply in server memory on a `stop` finish) →
 * `saveStudioChatTurn` (persists the staged reply and its bundle). An
 * aborted or failed turn calls `discardStudioChatTurn` instead, so nothing
 * of it is kept, except that suggestions prepare dismissed stay dismissed.
 */

export const STUDIO_CHAT_MAX_MESSAGE_CHARS = 4000;

export type StudioChatRole = "user" | "assistant";

/** One thing the agent did during a turn, as shown in the step list. */
export type StudioChatStep = { tool: string; label: string };

export type StudioChatThreadDto = {
  id: string;
  storyId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StudioChatMessageDto = {
  id: string;
  threadId: string;
  role: StudioChatRole;
  content: string;
  /** Assistant messages only; empty for user messages. */
  steps: StudioChatStep[];
  /** The bundle this assistant message proposed, if any. */
  bundleId: string | null;
  /** Shared by the user message and the reply of one turn. */
  generationId: string;
  position: number;
  createdAt: string;
};

export type StudioChatThreadDetail = {
  thread: StudioChatThreadDto;
  /** In position order. */
  messages: StudioChatMessageDto[];
  /** Every bundle a message in this thread proposed, in any status. */
  bundles: StudioBundleDto[];
};

export type StudioChatPreparedTurn = {
  thread: StudioChatThreadDto;
  userMessage: StudioChatMessageDto;
  generationId: string;
  /**
   * Bundles (any thread) whose still-pending ops this message dismissed
   * without review. Merge them into the workspace store so their in-place
   * suggestions disappear; they stay dismissed even if the turn is
   * discarded.
   */
  rejectedBundles: StudioBundleDto[];
};

export type StudioChatSavedTurn = {
  thread: StudioChatThreadDto;
  /** The turn's user message and its reply, in position order. */
  messages: StudioChatMessageDto[];
  bundle: StudioBundleDto | null;
};

export type StudioChatThreadDeleteResult = {
  /** False when the thread was already gone (nothing was changed). */
  deleted: boolean;
  /**
   * The thread's bundles that had pending ops, now rejected (rows kept;
   * accepted ops stay accepted). Merge them into the workspace store so
   * their in-place previews disappear.
   */
  rejectedBundles: StudioBundleDto[];
};

export type StudioChatDiscardResult = {
  /** False when there was nothing to discard (already gone or answered). */
  discarded: boolean;
  /** True when the thread had no other messages and was removed too. */
  threadDeleted: boolean;
};

const id = z.string().trim().min(1).max(128);

/** What the author is looking at; a hint, not an instruction. */
export const studioChatContextSchema = z.object({
  lookingAtItemId: id.nullable(),
});

export type StudioChatContext = z.infer<typeof studioChatContextSchema>;

/**
 * Route body. It carries no message text: the route reads the prepared
 * user message by generationId, so browser-supplied text never reaches the
 * model under the guise of a stored message.
 */
export const studioChatRequestSchema = z.object({
  storyId: id,
  threadId: id,
  generationId: id,
  context: studioChatContextSchema,
});

export type StudioChatRequest = z.infer<typeof studioChatRequestSchema>;

/** NDJSON events, one JSON object per line. */
export type StudioChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "step"; tool: string; label: string }
  | { type: "bundle"; opCount: number; summary: string }
  | { type: "complete" }
  | { type: "aborted" }
  | {
      type: "error";
      code: string;
      message: string;
      finishReason?: LocalinkTextStreamFinishReason;
    };

/**
 * Reads the chat stream. Resolves once `complete` arrives and the stream
 * ends. Throws `LocalinkTextStreamError` with code STREAM_UNAVAILABLE (no
 * body), STREAM_INVALID (malformed or unknown event, data after complete,
 * or a line over 1 MB), STREAM_ABORTED (`aborted` event), or the route's
 * sanitized error code; an error with a finish reason, or a stream that
 * ends without `complete`, throws `LocalinkTextStreamFinishError`.
 */
export async function readStudioChatStream(
  response: Response,
  {
    onDelta,
    onStep,
    onBundle,
    incompleteMessage = "The chat reply ended before completion.",
    unavailableMessage = "The chat reply stream is unavailable.",
  }: {
    onDelta: (text: string) => void;
    onStep?: (step: StudioChatStep) => void;
    onBundle?: (bundle: { opCount: number; summary: string }) => void;
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw invalid();
    }
    if (!parsed || typeof parsed !== "object") throw invalid();
    const event = parsed as Partial<Record<string, unknown>>;
    if (event.type === "delta" && typeof event.text === "string") {
      onDelta(event.text);
    } else if (
      event.type === "step" &&
      typeof event.tool === "string" &&
      typeof event.label === "string"
    ) {
      onStep?.({ tool: event.tool, label: event.label });
    } else if (
      event.type === "bundle" &&
      typeof event.opCount === "number" &&
      typeof event.summary === "string"
    ) {
      onBundle?.({ opCount: event.opCount, summary: event.summary });
    } else if (event.type === "complete") {
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
      const finishReason =
        typeof event.finishReason === "string" ? event.finishReason : undefined;
      if (finishReason !== undefined || event.code === "STREAM_INCOMPLETE") {
        throw new LocalinkTextStreamFinishError(finishReason, event.message);
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
    if (!complete) {
      throw new LocalinkTextStreamFinishError(undefined, incompleteMessage);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
