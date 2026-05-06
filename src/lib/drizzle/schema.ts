import { relations, sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { EMPTY_CHAPTER_CONTENT_HASH } from "../chapter-content-hash";

const currentTimestampSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type StoryCharacter = {
  id: string;
  name: string;
  description: string;
};

export type StoryChatMessageRole = "system" | "user" | "assistant";

export const localinkMetadata = sqliteTable("localink_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  characters: text("characters", { mode: "json" })
    .$type<StoryCharacter[]>()
    .notNull()
    .default(sql`'[]'`),
  style: text("style").notNull().default(""),
  createdAt: text("created_at").notNull().default(currentTimestampSql),
  updatedAt: text("updated_at").notNull().default(currentTimestampSql),
});

export const storyChats = sqliteTable(
  "story_chats",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("story_chats_story_updated_idx").on(table.storyId, table.updatedAt),
  ],
);

export const storyChatMessages = sqliteTable(
  "story_chat_messages",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => storyChats.id, { onDelete: "cascade" }),
    role: text("role").$type<StoryChatMessageRole>().notNull(),
    isVisible: integer("is_visible", { mode: "boolean" }).notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    generationId: text("generation_id"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("story_chat_messages_chat_position_idx").on(
      table.chatId,
      table.position,
    ),
    index("story_chat_messages_generation_idx").on(table.generationId),
    index("story_chat_messages_story_idx").on(table.storyId),
    check(
      "story_chat_messages_role_check",
      sql`${table.role} IN ('system', 'user', 'assistant')`,
    ),
    check(
      "story_chat_messages_visibility_role_check",
      sql`
        CASE
          WHEN ${table.isVisible} = 0 THEN ${table.role} = 'system'
          ELSE ${table.role} IN ('user', 'assistant')
        END
      `,
    ),
  ],
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    indexedHash: text("indexed_hash")
      .notNull()
      .default(EMPTY_CHAPTER_CONTENT_HASH),
    indexedAt: text("indexed_at"),
    summary: text("summary").notNull(),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("chapters_story_position_idx").on(table.storyId, table.position),
  ],
);

export const chunks = sqliteTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    startPosition: integer("start_position").notNull(),
    endPosition: integer("end_position").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
  },
  (table) => [
    index("chunks_story_idx").on(table.storyId),
    index("chunks_chapter_position_idx").on(
      table.chapterId,
      table.startPosition,
    ),
    check(
      "chunks_embedding_float32_vec_check",
      sql`
        CASE
          WHEN ${table.embedding} IS NULL THEN 1
          ELSE typeof(${table.embedding}) = 'blob'
            AND vec_type(${table.embedding}) = 'float32'
        END
      `,
    ),
  ],
);

export const storiesRelations = relations(stories, ({ many }) => ({
  chapters: many(chapters),
  chunks: many(chunks),
  storyChatMessages: many(storyChatMessages),
  storyChats: many(storyChats),
}));

export const storyChatsRelations = relations(storyChats, ({ many, one }) => ({
  story: one(stories, {
    fields: [storyChats.storyId],
    references: [stories.id],
  }),
  messages: many(storyChatMessages),
}));

export const storyChatMessagesRelations = relations(
  storyChatMessages,
  ({ one }) => ({
    story: one(stories, {
      fields: [storyChatMessages.storyId],
      references: [stories.id],
    }),
    chat: one(storyChats, {
      fields: [storyChatMessages.chatId],
      references: [storyChats.id],
    }),
  }),
);

export const chaptersRelations = relations(chapters, ({ many, one }) => ({
  story: one(stories, {
    fields: [chapters.storyId],
    references: [stories.id],
  }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  story: one(stories, {
    fields: [chunks.storyId],
    references: [stories.id],
  }),
  chapter: one(chapters, {
    fields: [chunks.chapterId],
    references: [chapters.id],
  }),
}));
