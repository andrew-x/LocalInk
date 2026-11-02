import "server-only";

import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkDb, type LocalinkTx } from "@/lib/drizzle/db";
import {
  studioBundles,
  studioChatMessages,
  studioChatThreads,
} from "@/lib/drizzle/schema";
import type { StudioBundleDto } from "@/lib/studio/bundle-contract";
import type {
  StudioChatDiscardResult,
  StudioChatMessageDto,
  StudioChatPreparedTurn,
  StudioChatRole,
  StudioChatSavedTurn,
  StudioChatStep,
  StudioChatThreadDeleteResult,
  StudioChatThreadDetail,
  StudioChatThreadDto,
} from "@/lib/studio/chat-contract";
import { generateId } from "@/lib/util";

import type { StudioChatBundleCandidate } from "./bundle-builder";
import {
  dismissPendingStudioBundles,
  getStudioBundleByGeneration,
  insertStudioBundle,
  resolveStudioBundle,
} from "./bundles";
import { requireStudioStory, toBundleDto } from "./repository";
import { getStudioStage, type StudioStageBinding } from "./staging";

/**
 * Persistence for Studio chat threads. A turn writes in two places: prepare
 * stores the user message (and a new thread for a first message); save
 * stores the staged reply and its bundle. Both take ids only, never text
 * from the route, and save is idempotent on generationId. Discard removes a
 * prepared message that never got a reply, so an aborted turn keeps
 * nothing of its own (suggestions prepare dismissed stay dismissed).
 */

type ThreadRow = typeof studioChatThreads.$inferSelect;
type MessageRow = typeof studioChatMessages.$inferSelect;
type Reader = LocalinkDb | LocalinkTx;

/** What the chat route stages for a `stop` finish. */
export type StagedStudioChatTurn = {
  assistantText: string;
  steps: StudioChatStep[];
  bundle: StudioChatBundleCandidate | null;
  /** When the turn started; becomes the bundle's createdAt. */
  proposedAt: string;
};

export type StudioChatTurnRef = {
  storyId: string;
  threadId: string;
  generationId: string;
};

export function chatStageBinding(turn: StudioChatTurnRef): StudioStageBinding {
  return {
    storyId: turn.storyId,
    kind: "chat",
    targetId: turn.threadId,
    generationId: turn.generationId,
  };
}

function toThreadDto(row: ThreadRow): StudioChatThreadDto {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessageDto(row: MessageRow): StudioChatMessageDto {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role,
    content: row.content,
    steps: row.steps,
    bundleId: row.bundleId,
    generationId: row.generationId,
    position: row.position,
    createdAt: row.createdAt,
  };
}

function deriveThreadTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length <= 60
    ? normalized
    : `${normalized.slice(0, 57).trimEnd()}...`;
}

function findThread(
  db: Reader,
  storyId: string,
  threadId: string,
): ThreadRow | undefined {
  return db
    .select()
    .from(studioChatThreads)
    .where(
      and(
        eq(studioChatThreads.id, threadId),
        eq(studioChatThreads.storyId, storyId),
      ),
    )
    .get();
}

function requireThread(
  db: Reader,
  storyId: string,
  threadId: string,
): ThreadRow {
  const thread = findThread(db, storyId, threadId);
  if (!thread) {
    throw new ActionError("BAD_REQUEST", "This chat could not be found.");
  }
  return thread;
}

function turnMessage(
  db: Reader,
  threadId: string,
  generationId: string,
  role: StudioChatRole,
): MessageRow | undefined {
  return db
    .select()
    .from(studioChatMessages)
    .where(
      and(
        eq(studioChatMessages.threadId, threadId),
        eq(studioChatMessages.generationId, generationId),
        eq(studioChatMessages.role, role),
      ),
    )
    .get();
}

function latestMessage(db: Reader, threadId: string): MessageRow | undefined {
  return db
    .select()
    .from(studioChatMessages)
    .where(eq(studioChatMessages.threadId, threadId))
    .orderBy(desc(studioChatMessages.position))
    .limit(1)
    .get();
}

function nextPosition(tx: LocalinkTx, threadId: string): number {
  const row = tx
    .select({ value: max(studioChatMessages.position) })
    .from(studioChatMessages)
    .where(eq(studioChatMessages.threadId, threadId))
    .get();
  return (row?.value ?? -1) + 1;
}

function bundlesById(
  db: Reader,
  storyId: string,
  ids: string[],
): Map<string, StudioBundleDto> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(
    db
      .select()
      .from(studioBundles)
      .where(
        and(
          eq(studioBundles.storyId, storyId),
          inArray(studioBundles.id, unique),
        ),
      )
      .all()
      .map((row) => [row.id, toBundleDto(row)]),
  );
}

/**
 * Stores the user message (and a new thread for a first message). In the
 * same transaction it dismisses every suggestion still pending in the
 * story, so the author's new message clears what was waiting. That stays
 * dismissed even if this turn is later discarded.
 */
export function prepareStudioChatTurn(
  tx: LocalinkTx,
  input: { storyId: string; threadId: string | null; content: string },
): StudioChatPreparedTurn {
  requireStudioStory(tx, input.storyId);
  const now = day().toISOString();
  let thread: ThreadRow;
  if (input.threadId) {
    thread = requireThread(tx, input.storyId, input.threadId);
    thread = tx
      .update(studioChatThreads)
      .set({ updatedAt: now })
      .where(eq(studioChatThreads.id, thread.id))
      .returning()
      .get();
  } else {
    thread = tx
      .insert(studioChatThreads)
      .values({
        id: generateId("studio-chat-thread"),
        storyId: input.storyId,
        title: deriveThreadTitle(input.content),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  const rejectedBundles = dismissPendingStudioBundles(tx, input.storyId);
  const generationId = generateId("studio-chat-generation");
  const message = tx
    .insert(studioChatMessages)
    .values({
      id: generateId("studio-chat-message"),
      threadId: thread.id,
      role: "user",
      content: input.content,
      steps: [],
      bundleId: null,
      generationId,
      position: nextPosition(tx, thread.id),
      createdAt: now,
    })
    .returning()
    .get();
  return {
    thread: toThreadDto(thread),
    userMessage: toMessageDto(message),
    generationId,
    rejectedBundles,
  };
}

/**
 * What the route sends the model: earlier answered turns and the prepared
 * user message, which must be the thread's latest message and unanswered.
 * A user message left without a reply (a failed discard) is not history.
 */
export function loadStudioChatTurn(turn: StudioChatTurnRef): {
  thread: StudioChatThreadDto;
  messages: StudioChatMessageDto[];
  bundles: Map<string, StudioBundleDto>;
} {
  return getDb().transaction((tx) => {
    const thread = requireThread(tx, turn.storyId, turn.threadId);
    const user = turnMessage(tx, thread.id, turn.generationId, "user");
    if (!user) {
      throw new ActionError(
        "BAD_REQUEST",
        "This chat message could not be found. Send it again.",
      );
    }
    if (turnMessage(tx, thread.id, turn.generationId, "assistant")) {
      throw new ActionError(
        "BAD_REQUEST",
        "This chat message already has a reply.",
      );
    }
    if (latestMessage(tx, thread.id)?.id !== user.id) {
      throw new ActionError(
        "BAD_REQUEST",
        "A newer message was sent in this chat. Reload the chat and try again.",
      );
    }
    const rows = tx
      .select()
      .from(studioChatMessages)
      .where(eq(studioChatMessages.threadId, thread.id))
      .orderBy(asc(studioChatMessages.position))
      .all()
      .filter((row) => row.position < user.position);
    const answered = new Set(
      rows
        .filter((row) => row.role === "assistant")
        .map((row) => row.generationId),
    );
    const history = rows.filter(
      (row) => row.role === "assistant" || answered.has(row.generationId),
    );
    return {
      thread: toThreadDto(thread),
      messages: [...history, user].map(toMessageDto),
      bundles: bundlesById(
        tx,
        turn.storyId,
        history.flatMap((row) => (row.bundleId ? [row.bundleId] : [])),
      ),
    };
  });
}

/**
 * Persists the staged reply. A reply already saved for this generation is
 * returned as is (a retry after a lost response), even once the stage is
 * gone. Otherwise the prepared user message must still be the latest one,
 * and the staged output (never browser text) is stored with its bundle.
 * The caller drops the stage after the transaction commits.
 */
export function saveStudioChatTurn(
  tx: LocalinkTx,
  turn: StudioChatTurnRef,
): StudioChatSavedTurn {
  const thread = requireThread(tx, turn.storyId, turn.threadId);
  const user = turnMessage(tx, thread.id, turn.generationId, "user");
  if (!user) {
    throw new ActionError(
      "BAD_REQUEST",
      "This chat message could not be found, so the reply can't be saved.",
    );
  }
  const existing = turnMessage(tx, thread.id, turn.generationId, "assistant");
  if (existing) {
    return {
      thread: toThreadDto(thread),
      messages: [user, existing].map(toMessageDto),
      bundle: existing.bundleId
        ? getStudioBundleByGeneration(tx, turn.storyId, turn.generationId)
        : null,
    };
  }
  if (latestMessage(tx, thread.id)?.id !== user.id) {
    throw new ActionError(
      "CONFLICT",
      "A newer message was sent in this chat. Reload the chat before saving this reply.",
    );
  }
  const staged = getStudioStage<StagedStudioChatTurn>(chatStageBinding(turn));
  const now = day().toISOString();
  const messageId = generateId("studio-chat-message");
  const bundle = staged.bundle
    ? insertStudioBundle(tx, {
        storyId: turn.storyId,
        source: "chat",
        threadId: thread.id,
        messageId,
        generationId: turn.generationId,
        summary: staged.bundle.summary,
        operations: staged.bundle.operations,
        proposedAt: staged.proposedAt,
      })
    : null;
  const content = staged.assistantText.trim() || staged.bundle?.summary || "";
  if (!content) {
    throw new ActionError(
      "GENERATION_FAILED",
      "The reply was empty. Send the message again.",
    );
  }
  const message = tx
    .insert(studioChatMessages)
    .values({
      id: messageId,
      threadId: thread.id,
      role: "assistant",
      content,
      steps: staged.steps,
      bundleId: bundle?.id ?? null,
      generationId: turn.generationId,
      position: nextPosition(tx, thread.id),
      createdAt: now,
    })
    .returning()
    .get();
  const updated = tx
    .update(studioChatThreads)
    .set({ updatedAt: now })
    .where(eq(studioChatThreads.id, thread.id))
    .returning()
    .get();
  return {
    thread: toThreadDto(updated),
    messages: [user, message].map(toMessageDto),
    bundle,
  };
}

/**
 * Removes a prepared user message that never got a reply, and the thread
 * when nothing else is left in it. Idempotent: an answered, missing, or
 * already discarded turn is a no-op. The caller drops any stage after the
 * transaction commits, so a reply still streaming cannot be saved later.
 */
export function discardStudioChatTurn(
  tx: LocalinkTx,
  turn: StudioChatTurnRef,
): StudioChatDiscardResult {
  const none = { discarded: false, threadDeleted: false };
  const thread = findThread(tx, turn.storyId, turn.threadId);
  if (!thread) return none;
  if (turnMessage(tx, thread.id, turn.generationId, "assistant")) return none;
  const user = turnMessage(tx, thread.id, turn.generationId, "user");
  if (!user) return none;
  tx.delete(studioChatMessages).where(eq(studioChatMessages.id, user.id)).run();
  const left =
    tx
      .select({ value: count() })
      .from(studioChatMessages)
      .where(eq(studioChatMessages.threadId, thread.id))
      .get()?.value ?? 0;
  if (left === 0) {
    tx.delete(studioChatThreads)
      .where(eq(studioChatThreads.id, thread.id))
      .run();
  }
  return { discarded: true, threadDeleted: left === 0 };
}

export function listStudioChatThreads(storyId: string): StudioChatThreadDto[] {
  return getDb()
    .select()
    .from(studioChatThreads)
    .where(eq(studioChatThreads.storyId, storyId))
    .orderBy(
      desc(studioChatThreads.updatedAt),
      desc(studioChatThreads.createdAt),
      desc(studioChatThreads.id),
    )
    .all()
    .map(toThreadDto);
}

export function loadStudioChatThread(
  storyId: string,
  threadId: string,
): StudioChatThreadDetail | null {
  return getDb().transaction((tx) => {
    const thread = findThread(tx, storyId, threadId);
    if (!thread) return null;
    const messages = tx
      .select()
      .from(studioChatMessages)
      .where(eq(studioChatMessages.threadId, thread.id))
      .orderBy(asc(studioChatMessages.position))
      .all();
    const bundles = bundlesById(
      tx,
      storyId,
      messages.flatMap((row) => (row.bundleId ? [row.bundleId] : [])),
    );
    return {
      thread: toThreadDto(thread),
      messages: messages.map(toMessageDto),
      bundles: [...bundles.values()].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    };
  });
}

/**
 * Deletes a thread and its messages. The pending ops of its bundles are
 * rejected first, in the same transaction, through the bundle reject path
 * (op statuses and updatedAt stay consistent; the rows are kept): once the
 * thread is gone there is no review card left to accept them from (Ruling
 * A25). Accepted ops stay undoable from the workspace. Idempotent: a
 * missing thread deletes and rejects nothing.
 */
export function deleteStudioChatThread(
  tx: LocalinkTx,
  input: { storyId: string; threadId: string },
): StudioChatThreadDeleteResult {
  const thread = findThread(tx, input.storyId, input.threadId);
  if (!thread) return { deleted: false, rejectedBundles: [] };
  const rejectedBundles = tx
    .select({ id: studioBundles.id })
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.storyId, input.storyId),
        eq(studioBundles.threadId, thread.id),
        eq(studioBundles.status, "pending"),
      ),
    )
    .orderBy(asc(studioBundles.createdAt), asc(studioBundles.id))
    .all()
    .map(
      ({ id }) =>
        resolveStudioBundle(tx, {
          storyId: input.storyId,
          bundleId: id,
          decision: "reject",
          opIds: null,
        }).bundle,
    );
  tx.delete(studioChatThreads).where(eq(studioChatThreads.id, thread.id)).run();
  return { deleted: true, rejectedBundles };
}
