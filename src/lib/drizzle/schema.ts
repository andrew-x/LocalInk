import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const currentTimestampSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type StoryCharacter = {
  id: string;
  name: string;
  description: string;
};

export type StoryLocation = {
  id: string;
  name: string;
  description: string;
};

export type StoryChatMessageRole = "system" | "user" | "assistant";
export type GeneratedImageStylePreset =
  | "amateur-photo"
  | "social-media-photo"
  | "professional-posed-photo"
  | "cinematic-photo"
  | "custom";

export const metadata = sqliteTable("metadata", {
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
  locations: text("locations", { mode: "json" })
    .$type<StoryLocation[]>()
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
    uniqueIndex("story_chat_messages_chat_position_unique").on(
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
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("chapters_story_position_idx").on(table.storyId, table.position),
  ],
);

export const generatedImages = sqliteTable(
  "generated_images",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerResponseId: text("provider_response_id"),
    prompt: text("prompt").notNull(),
    stylePreset: text("style_preset")
      .$type<GeneratedImageStylePreset>()
      .notNull(),
    stylePrompt: text("style_prompt").notNull(),
    model: text("model").notNull(),
    aspectRatio: text("aspect_ratio").notNull(),
    imageSize: text("image_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type").notNull(),
    fileRelativePath: text("file_relative_path").notNull(),
    fileSize: integer("file_size").notNull(),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("generated_images_created_at_idx").on(table.createdAt),
    check(
      "generated_images_style_preset_check",
      sql`${table.stylePreset} IN ('amateur-photo', 'social-media-photo', 'professional-posed-photo', 'cinematic-photo', 'custom')`,
    ),
  ],
);

export const storiesRelations = relations(stories, ({ many }) => ({
  chapters: many(chapters),
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

export const chaptersRelations = relations(chapters, ({ one }) => ({
  story: one(stories, {
    fields: [chapters.storyId],
    references: [stories.id],
  }),
}));
