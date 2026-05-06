import "server-only";

import type { ModelMessage } from "ai";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";

import type {
  PreparedStoryChatGeneration,
  SavedStoryChatAssistantOutput,
  StoryChatDetail,
  StoryChatListItem,
  StoryChatVisibleMessage,
} from "@/actions/story-chats/_types";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkDb } from "@/lib/drizzle/db";
import {
  chapters,
  type StoryChatMessageRole,
  stories,
  storyChatMessages,
  storyChats,
} from "@/lib/drizzle/schema";
import { normalizeStoryCharacters } from "@/lib/server/story-characters";
import { generateId } from "@/lib/util";

const MAX_CONTEXT_SNAPSHOT_CHARS = 80_000;
const OMITTED_CONTEXT_MARKER =
  "[Context snapshot shortened to fit the model context.]";

type PrepareStoryChatTurnInput = {
  storyId: string;
  chatId?: string | null;
  content: string;
};

type PrepareStoryChatRegenerationInput = {
  storyId: string;
  chatId: string;
  assistantMessageId: string;
};

type SaveStoryChatAssistantOutputInput = {
  storyId: string;
  chatId: string;
  generationId: string;
  contextMessageId: string;
  replaceAssistantMessageId?: string;
  content: string;
};

type BuildStoryChatGenerationMessagesInput = {
  storyId: string;
  chatId: string;
  generationId: string;
  contextMessageId: string;
  replaceAssistantMessageId?: string;
};

export function buildStoryChatSystemPrompt(): string {
  return [
    "You are LocalInk's private story planning and brainstorming assistant.",
    "Help the writer reason about plot, character, structure, setting, continuity, and revision options for the current story.",
    "Use the hidden story context snapshot to stay specific, but do not mention hidden messages, snapshots, database records, or implementation details.",
    "Do not quote or reproduce long manuscript passages. Prefer concise planning help unless the writer asks for draft prose.",
    "When offering prose, keep it clearly framed as a draft option and preserve the user's style guidance.",
  ].join("\n");
}

export async function listStoryChats(
  storyId: string,
): Promise<StoryChatListItem[]> {
  const rows = await getDb()
    .select({
      id: storyChats.id,
      title: storyChats.title,
      createdAt: storyChats.createdAt,
      updatedAt: storyChats.updatedAt,
    })
    .from(storyChats)
    .where(eq(storyChats.storyId, storyId))
    .orderBy(desc(storyChats.updatedAt), desc(storyChats.createdAt));

  return rows;
}

export async function loadStoryChat(
  storyId: string,
  chatId: string,
): Promise<StoryChatDetail | null> {
  const db = getDb();
  const chat = await findStoryChat(db, storyId, chatId);

  if (!chat) {
    return null;
  }

  return {
    ...chat,
    messages: await getVisibleStoryChatMessages(db, storyId, chatId),
  };
}

export async function prepareStoryChatTurn({
  storyId,
  chatId,
  content,
}: PrepareStoryChatTurnInput): Promise<PreparedStoryChatGeneration> {
  const db = getDb();
  const now = day().toISOString();
  const snapshot = await buildStoryChatContextSnapshot(storyId);
  const generationId = generateId("story-chat-generation");
  const contextMessageId = generateId("story-chat-message");
  let chat = chatId ? await findStoryChat(db, storyId, chatId) : null;

  if (chatId && !chat) {
    throw new ActionError("BAD_REQUEST", "The chat could not be found.");
  }

  if (!chat) {
    const newChat = {
      id: generateId("story-chat"),
      storyId,
      title: deriveChatTitle(content),
      createdAt: now,
      updatedAt: now,
    } satisfies typeof storyChats.$inferInsert;

    await db.insert(storyChats).values(newChat);
    chat = toStoryChatListItem(newChat);
  }

  const contextPosition = await getNextMessagePosition(db, chat.id);

  await db.insert(storyChatMessages).values([
    {
      id: contextMessageId,
      storyId,
      chatId: chat.id,
      role: "system",
      isVisible: false,
      position: contextPosition,
      content: snapshot,
      generationId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId("story-chat-message"),
      storyId,
      chatId: chat.id,
      role: "user",
      isVisible: true,
      position: contextPosition + 1,
      content,
      generationId,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await db
    .update(storyChats)
    .set({ updatedAt: now })
    .where(and(eq(storyChats.id, chat.id), eq(storyChats.storyId, storyId)));

  const detail = await loadRequiredStoryChat(db, storyId, chat.id);

  return {
    chat: toStoryChatListItem({ ...detail, updatedAt: now }),
    contextMessageId,
    generationId,
    messages: detail.messages,
  };
}

export async function prepareStoryChatRegeneration({
  storyId,
  chatId,
  assistantMessageId,
}: PrepareStoryChatRegenerationInput): Promise<PreparedStoryChatGeneration> {
  const db = getDb();
  const chat = await findStoryChat(db, storyId, chatId);

  if (!chat) {
    throw new ActionError("BAD_REQUEST", "The chat could not be found.");
  }

  const latestMessage = await getLatestVisibleStoryChatMessage(
    db,
    storyId,
    chatId,
  );

  if (
    !latestMessage ||
    latestMessage.role !== "assistant" ||
    latestMessage.id !== assistantMessageId
  ) {
    throw new ActionError(
      "BAD_REQUEST",
      "Only the latest assistant reply can be regenerated.",
    );
  }

  const now = day().toISOString();
  const generationId = generateId("story-chat-generation");
  const contextMessageId = generateId("story-chat-message");

  await db.insert(storyChatMessages).values({
    id: contextMessageId,
    storyId,
    chatId,
    role: "system",
    isVisible: false,
    position: await getNextMessagePosition(db, chatId),
    content: await buildStoryChatContextSnapshot(storyId),
    generationId,
    createdAt: now,
    updatedAt: now,
  });

  return {
    chat,
    contextMessageId,
    generationId,
    messages: await getVisibleStoryChatMessages(db, storyId, chatId),
    replaceAssistantMessageId: assistantMessageId,
  };
}

export async function saveStoryChatAssistantOutput({
  storyId,
  chatId,
  generationId,
  contextMessageId,
  replaceAssistantMessageId,
  content,
}: SaveStoryChatAssistantOutputInput): Promise<SavedStoryChatAssistantOutput> {
  const db = getDb();
  const now = day().toISOString();
  const hasPreparedGeneration = await findGenerationContextMessage(db, {
    storyId,
    chatId,
    generationId,
    contextMessageId,
  });

  if (!hasPreparedGeneration) {
    throw new ActionError(
      "BAD_REQUEST",
      "The prepared chat generation could not be found.",
    );
  }

  const message = replaceAssistantMessageId
    ? await replaceAssistantOutput(db, {
        storyId,
        chatId,
        assistantMessageId: replaceAssistantMessageId,
        generationId,
        content,
        now,
      })
    : await createAssistantOutput(db, {
        storyId,
        chatId,
        generationId,
        content,
        now,
      });

  await db
    .update(storyChats)
    .set({ updatedAt: now })
    .where(and(eq(storyChats.id, chatId), eq(storyChats.storyId, storyId)));

  const chat = await findStoryChat(db, storyId, chatId);

  if (!chat) {
    throw new ActionError("BAD_REQUEST", "The chat could not be found.");
  }

  return {
    chat: { ...chat, updatedAt: now },
    message,
  };
}

export async function buildStoryChatGenerationMessages({
  storyId,
  chatId,
  generationId,
  contextMessageId,
  replaceAssistantMessageId,
}: BuildStoryChatGenerationMessagesInput): Promise<ModelMessage[]> {
  const db = getDb();
  const contextMessage = await findGenerationContextMessage(db, {
    storyId,
    chatId,
    generationId,
    contextMessageId,
  });

  if (!contextMessage) {
    throw new ActionError(
      "BAD_REQUEST",
      "The prepared chat generation could not be found.",
    );
  }

  const beforePosition = replaceAssistantMessageId
    ? await getRegenerationHistoryCutoffPosition(
        db,
        storyId,
        chatId,
        replaceAssistantMessageId,
      )
    : undefined;
  const visibleMessages = await getVisibleStoryChatMessages(
    db,
    storyId,
    chatId,
    beforePosition,
  );

  return [
    {
      role: "system",
      content: contextMessage.content,
    },
    ...visibleMessages.map(toModelMessage),
  ];
}

export async function buildStoryChatContextSnapshot(
  storyId: string,
): Promise<string> {
  const db = getDb();
  const [story] = await db
    .select({
      id: stories.id,
      name: stories.name,
      description: stories.description,
      characters: stories.characters,
      style: stories.style,
      updatedAt: stories.updatedAt,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);

  if (!story) {
    throw new ActionError("BAD_REQUEST", "The story could not be found.");
  }

  const storyChapters = await db
    .select({
      name: chapters.name,
      position: chapters.position,
      summary: chapters.summary,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .where(eq(chapters.storyId, storyId))
    .orderBy(asc(chapters.position));
  const snapshot = [
    snapshotSection(
      "Story",
      [
        `Name: ${story.name}`,
        `Description: ${story.description.trim() || "No description provided."}`,
        `Story updated: ${story.updatedAt}`,
      ].join("\n"),
    ),
    snapshotSection("Style", story.style.trim() || "No style guide provided."),
    snapshotSection(
      "Characters",
      buildCharactersSnapshot(normalizeStoryCharacters(story.characters)),
    ),
    snapshotSection("Chapters", buildChaptersSnapshot(storyChapters)),
  ].join("\n\n");

  return trimContextSnapshot(snapshot);
}

async function loadRequiredStoryChat(
  db: LocalinkDb,
  storyId: string,
  chatId: string,
): Promise<StoryChatDetail> {
  const chat = await findStoryChat(db, storyId, chatId);

  if (!chat) {
    throw new ActionError("BAD_REQUEST", "The chat could not be found.");
  }

  return {
    ...chat,
    messages: await getVisibleStoryChatMessages(db, storyId, chatId),
  };
}

async function findStoryChat(
  db: LocalinkDb,
  storyId: string,
  chatId: string,
): Promise<StoryChatListItem | null> {
  const [chat] = await db
    .select({
      id: storyChats.id,
      title: storyChats.title,
      createdAt: storyChats.createdAt,
      updatedAt: storyChats.updatedAt,
    })
    .from(storyChats)
    .where(and(eq(storyChats.id, chatId), eq(storyChats.storyId, storyId)))
    .limit(1);

  return chat ?? null;
}

async function getVisibleStoryChatMessages(
  db: LocalinkDb,
  storyId: string,
  chatId: string,
  beforePosition?: number,
): Promise<StoryChatVisibleMessage[]> {
  const filters = [
    eq(storyChatMessages.storyId, storyId),
    eq(storyChatMessages.chatId, chatId),
    eq(storyChatMessages.isVisible, true),
  ];

  if (beforePosition !== undefined) {
    filters.push(lt(storyChatMessages.position, beforePosition));
  }

  const rows = await db
    .select({
      id: storyChatMessages.id,
      role: storyChatMessages.role,
      content: storyChatMessages.content,
      createdAt: storyChatMessages.createdAt,
      updatedAt: storyChatMessages.updatedAt,
    })
    .from(storyChatMessages)
    .where(and(...filters))
    .orderBy(asc(storyChatMessages.position));

  return rows.map(toVisibleMessage);
}

async function getLatestVisibleStoryChatMessage(
  db: LocalinkDb,
  storyId: string,
  chatId: string,
): Promise<StoryChatVisibleMessage | null> {
  const [message] = await db
    .select({
      id: storyChatMessages.id,
      role: storyChatMessages.role,
      content: storyChatMessages.content,
      createdAt: storyChatMessages.createdAt,
      updatedAt: storyChatMessages.updatedAt,
    })
    .from(storyChatMessages)
    .where(
      and(
        eq(storyChatMessages.storyId, storyId),
        eq(storyChatMessages.chatId, chatId),
        eq(storyChatMessages.isVisible, true),
      ),
    )
    .orderBy(desc(storyChatMessages.position))
    .limit(1);

  return message ? toVisibleMessage(message) : null;
}

async function findGenerationContextMessage(
  db: LocalinkDb,
  {
    storyId,
    chatId,
    generationId,
    contextMessageId,
  }: {
    storyId: string;
    chatId: string;
    generationId: string;
    contextMessageId: string;
  },
) {
  const [message] = await db
    .select({
      id: storyChatMessages.id,
      content: storyChatMessages.content,
    })
    .from(storyChatMessages)
    .where(
      and(
        eq(storyChatMessages.id, contextMessageId),
        eq(storyChatMessages.storyId, storyId),
        eq(storyChatMessages.chatId, chatId),
        eq(storyChatMessages.generationId, generationId),
        eq(storyChatMessages.role, "system"),
        eq(storyChatMessages.isVisible, false),
      ),
    )
    .limit(1);

  return message ?? null;
}

async function getRegenerationHistoryCutoffPosition(
  db: LocalinkDb,
  storyId: string,
  chatId: string,
  assistantMessageId: string,
): Promise<number> {
  const [message] = await db
    .select({
      id: storyChatMessages.id,
      position: storyChatMessages.position,
    })
    .from(storyChatMessages)
    .where(
      and(
        eq(storyChatMessages.id, assistantMessageId),
        eq(storyChatMessages.storyId, storyId),
        eq(storyChatMessages.chatId, chatId),
        eq(storyChatMessages.role, "assistant"),
        eq(storyChatMessages.isVisible, true),
      ),
    )
    .limit(1);

  if (!message) {
    throw new ActionError(
      "BAD_REQUEST",
      "The assistant reply could not be found.",
    );
  }

  return message.position;
}

async function replaceAssistantOutput(
  db: LocalinkDb,
  {
    storyId,
    chatId,
    assistantMessageId,
    generationId,
    content,
    now,
  }: {
    storyId: string;
    chatId: string;
    assistantMessageId: string;
    generationId: string;
    content: string;
    now: string;
  },
): Promise<StoryChatVisibleMessage> {
  const latestMessage = await getLatestVisibleStoryChatMessage(
    db,
    storyId,
    chatId,
  );

  if (!latestMessage || latestMessage.id !== assistantMessageId) {
    throw new ActionError(
      "BAD_REQUEST",
      "Only the latest assistant reply can be replaced.",
    );
  }

  const [message] = await db
    .update(storyChatMessages)
    .set({
      content,
      generationId,
      updatedAt: now,
    })
    .where(
      and(
        eq(storyChatMessages.id, assistantMessageId),
        eq(storyChatMessages.storyId, storyId),
        eq(storyChatMessages.chatId, chatId),
        eq(storyChatMessages.role, "assistant"),
        eq(storyChatMessages.isVisible, true),
      ),
    )
    .returning({
      id: storyChatMessages.id,
      role: storyChatMessages.role,
      content: storyChatMessages.content,
      createdAt: storyChatMessages.createdAt,
      updatedAt: storyChatMessages.updatedAt,
    });

  if (!message) {
    throw new ActionError(
      "BAD_REQUEST",
      "The assistant reply could not be found.",
    );
  }

  return toVisibleMessage(message);
}

async function createAssistantOutput(
  db: LocalinkDb,
  {
    storyId,
    chatId,
    generationId,
    content,
    now,
  }: {
    storyId: string;
    chatId: string;
    generationId: string;
    content: string;
    now: string;
  },
): Promise<StoryChatVisibleMessage> {
  const [existingMessage] = await db
    .select({
      id: storyChatMessages.id,
      role: storyChatMessages.role,
      content: storyChatMessages.content,
      createdAt: storyChatMessages.createdAt,
      updatedAt: storyChatMessages.updatedAt,
    })
    .from(storyChatMessages)
    .where(
      and(
        eq(storyChatMessages.storyId, storyId),
        eq(storyChatMessages.chatId, chatId),
        eq(storyChatMessages.generationId, generationId),
        eq(storyChatMessages.role, "assistant"),
        eq(storyChatMessages.isVisible, true),
      ),
    )
    .limit(1);

  if (existingMessage) {
    return toVisibleMessage(existingMessage);
  }

  const [message] = await db
    .insert(storyChatMessages)
    .values({
      id: generateId("story-chat-message"),
      storyId,
      chatId,
      role: "assistant",
      isVisible: true,
      position: await getNextMessagePosition(db, chatId),
      content,
      generationId,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: storyChatMessages.id,
      role: storyChatMessages.role,
      content: storyChatMessages.content,
      createdAt: storyChatMessages.createdAt,
      updatedAt: storyChatMessages.updatedAt,
    });

  if (!message) {
    throw new ActionError(
      "INTERNAL_ERROR",
      "The assistant output could not be saved.",
    );
  }

  return toVisibleMessage(message);
}

async function getNextMessagePosition(
  db: LocalinkDb,
  chatId: string,
): Promise<number> {
  const [row] = await db
    .select({
      nextPosition: sql<number>`coalesce(max(${storyChatMessages.position}), 0) + 1`,
    })
    .from(storyChatMessages)
    .where(eq(storyChatMessages.chatId, chatId));

  return row?.nextPosition ?? 1;
}

function toStoryChatListItem(chat: StoryChatListItem): StoryChatListItem {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

function toVisibleMessage(message: {
  id: string;
  role: StoryChatMessageRole;
  content: string;
  createdAt: string;
  updatedAt: string;
}): StoryChatVisibleMessage {
  if (message.role === "system") {
    throw new Error("Hidden context messages cannot be rendered.");
  }

  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function toModelMessage(message: StoryChatVisibleMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

function buildCharactersSnapshot(
  characters: ReturnType<typeof normalizeStoryCharacters>,
): string {
  if (!characters.length) {
    return "No character notes provided.";
  }

  return characters
    .map((character) => {
      const description = character.description.trim();

      return `- ${character.name}: ${description || "No description provided."}`;
    })
    .join("\n");
}

function buildChaptersSnapshot(
  storyChapters: {
    name: string;
    position: number;
    summary: string;
    updatedAt: string;
  }[],
): string {
  if (!storyChapters.length) {
    return "No chapters yet.";
  }

  return storyChapters
    .map((chapter) =>
      [
        `${chapter.position}. ${chapter.name}`,
        `Summary: ${chapter.summary.trim() || "No summary provided."}`,
        `Updated: ${chapter.updatedAt}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function snapshotSection(title: string, content: string): string {
  const tag = title.toUpperCase().replace(/\s+/g, "_");

  return `<${tag}>\n${content}\n</${tag}>`;
}

function trimContextSnapshot(snapshot: string): string {
  if (snapshot.length <= MAX_CONTEXT_SNAPSHOT_CHARS) {
    return snapshot;
  }

  const retainedChars = Math.max(
    0,
    MAX_CONTEXT_SNAPSHOT_CHARS - OMITTED_CONTEXT_MARKER.length,
  );
  const headChars = Math.ceil(retainedChars * 0.7);
  const tailChars = Math.floor(retainedChars * 0.3);

  return [
    snapshot.slice(0, headChars).trimEnd(),
    "",
    OMITTED_CONTEXT_MARKER,
    "",
    snapshot.slice(snapshot.length - tailChars).trimStart(),
  ].join("\n");
}

function deriveChatTitle(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (normalized.length <= 60) {
    return normalized;
  }

  return `${normalized.slice(0, 57).trimEnd()}...`;
}
