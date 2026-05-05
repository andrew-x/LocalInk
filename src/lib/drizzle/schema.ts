import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const currentTimestampSql = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export type StoryCharacter = {
  id: string;
  name: string;
  description: string;
};

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
    summary: text("summary").notNull(),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("chapters_story_position_idx").on(table.storyId, table.position),
  ],
);

export const storiesRelations = relations(stories, ({ many }) => ({
  chapters: many(chapters),
}));

export const chaptersRelations = relations(chapters, ({ one }) => ({
  story: one(stories, {
    fields: [chapters.storyId],
    references: [stories.id],
  }),
}));
