import { relations, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  StoryDetailsChange,
  StoryDetailsProposalStatus,
} from "@/lib/story-details-contract";
import type { StoryGenerationModel } from "@/lib/story-generation-models";
import { DEFAULT_STORY_GENERATION_MODEL } from "@/lib/story-generation-models";
import type {
  ManuscriptProposalChapter,
  ManuscriptProposalStatus,
} from "@/lib/story-manuscript-contract";
import type {
  StudioBundleOp,
  StudioBundleSource,
  StudioBundleStatus,
} from "@/lib/studio/bundle-contract";
import type {
  StudioAspect,
  StudioChangeMode,
  StudioChangeSource,
  StudioChangeStatus,
  StudioEntryType,
  StudioFlagKind,
  StudioFlagPayload,
  StudioFlagStatus,
  StudioPlanField,
  StudioPlanKind,
  StudioPlanOrigin,
  StudioProseOrigin,
  StudioSetupStatus,
  StudioStructureTemplateId,
  StudioStyle,
  StudioVoiceSample,
} from "@/lib/studio/contracts";

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

/**
 * A passage the writer marked as representative of the target voice.
 *
 * Kept separate from the style guide because a sample is shown to the model as
 * prose to match rather than instructions to follow, and because the
 * manuscript cannot serve this purpose: nearly all of it is model output, so
 * treating it as the voice target just reinforces whatever the model already
 * does.
 */
export type StoryVoiceExemplar = {
  id: string;
  label: string;
  text: string;
};

export type StoryChatMessageRole = "system" | "user" | "assistant";
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
  backstory: text("backstory").notNull().default(""),
  locations: text("locations", { mode: "json" })
    .$type<StoryLocation[]>()
    .notNull()
    .default(sql`'[]'`),
  style: text("style").notNull().default(""),
  systemInstructions: text("system_instructions").notNull().default(""),
  voiceExemplars: text("voice_exemplars", { mode: "json" })
    .$type<StoryVoiceExemplar[]>()
    .notNull()
    .default(sql`'[]'`),
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
    contentRevision: integer("content_revision").notNull().default(0),
    // A compact, factual account of what this chapter establishes, generated
    // in the background by the default Flash model. Prose generation reads it so the
    // model does not have to re-derive story state from raw text on every
    // request, and so distant chapters can be carried by summary alone.
    synopsis: text("synopsis").notNull().default(""),
    // Hash of the content the synopsis was generated from. Cheaper and more
    // reliable than a timestamp comparison for deciding staleness.
    synopsisSourceHash: text("synopsis_source_hash").notNull().default(""),
    synopsisUpdatedAt: text("synopsis_updated_at"),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("chapters_story_position_idx").on(table.storyId, table.position),
  ],
);

export const storyChatEditProposals = sqliteTable(
  "story_chat_edit_proposals",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => storyChats.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => storyChatMessages.id, { onDelete: "cascade" }),
    generationId: text("generation_id").notNull(),
    summary: text("summary").notNull(),
    chapters: text("chapters", { mode: "json" })
      .$type<ManuscriptProposalChapter[]>()
      .notNull(),
    status: text("status")
      .$type<ManuscriptProposalStatus>()
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    uniqueIndex("story_chat_edit_proposals_generation_unique").on(
      table.generationId,
    ),
    uniqueIndex("story_chat_edit_proposals_message_unique").on(table.messageId),
    index("story_chat_edit_proposals_chat_idx").on(table.chatId),
    check(
      "story_chat_edit_proposals_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'rejected', 'undone')`,
    ),
  ],
);

export const storyChatDetailProposals = sqliteTable(
  "story_chat_detail_proposals",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => storyChats.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => storyChatMessages.id, { onDelete: "cascade" }),
    generationId: text("generation_id").notNull(),
    summary: text("summary").notNull(),
    changes: text("changes", { mode: "json" })
      .$type<StoryDetailsChange[]>()
      .notNull(),
    status: text("status")
      .$type<StoryDetailsProposalStatus>()
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    uniqueIndex("story_chat_detail_proposals_generation_unique").on(
      table.generationId,
    ),
    uniqueIndex("story_chat_detail_proposals_message_unique").on(
      table.messageId,
    ),
    index("story_chat_detail_proposals_chat_idx").on(table.chatId),
    check(
      "story_chat_detail_proposals_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'rejected', 'undone')`,
    ),
  ],
);

export const generatedImages = sqliteTable(
  "generated_images",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerResponseId: text("provider_response_id"),
    prompt: text("prompt").notNull(),
    // The description the user typed when enhancement replaced it. Null means
    // `prompt` is the user's own text, which is also all a row written before
    // this column existed can say.
    originalPrompt: text("original_prompt"),
    stylePreset: text("style_preset").notNull(),
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
  (table) => [index("generated_images_created_at_idx").on(table.createdAt)],
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

const emptyJsonArraySql = sql`'[]'`;
const emptyJsonObjectSql = sql`'{}'`;

export const studioStories = sqliteTable(
  "studio_stories",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    overview: text("overview").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    style: text("style", { mode: "json" })
      .$type<StudioStyle>()
      .notNull()
      .default(
        sql`'{"povAndTense":"","register":"","pacing":"","avoid":"","notes":""}'`,
      ),
    theme: text("theme").notNull().default(""),
    structureTemplate: text("structure_template")
      .$type<StudioStructureTemplateId>()
      .notNull()
      .default("freeform"),
    structureNotes: text("structure_notes").notNull().default(""),
    brainDump: text("brain_dump").notNull().default(""),
    voiceSamples: text("voice_samples", { mode: "json" })
      .$type<StudioVoiceSample[]>()
      .notNull()
      .default(emptyJsonArraySql),
    proseModel: text("prose_model")
      .$type<StoryGenerationModel>()
      .notNull()
      .default(DEFAULT_STORY_GENERATION_MODEL),
    setupStatus: text("setup_status")
      .$type<StudioSetupStatus>()
      .notNull()
      .default("draft"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    check(
      "studio_stories_structure_template_check",
      sql`${table.structureTemplate} IN ('romance', 'coming-of-age', 'quiet', 'freeform')`,
    ),
    check(
      "studio_stories_setup_status_check",
      sql`${table.setupStatus} IN ('draft', 'planned')`,
    ),
  ],
);

export const studioEntries = sqliteTable(
  "studio_entries",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    type: text("type").$type<StudioEntryType>().notNull(),
    customTypeLabel: text("custom_type_label").notNull().default(""),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    fields: text("fields", { mode: "json" })
      // Entry fields are a StudioEntryField[] in the current shape; rows
      // written before Amendment A hold a legacy key record. Read through
      // normalizeEntryFields, never directly.
      .$type<unknown>()
      .notNull()
      .default(emptyJsonObjectSql),
    relatedEntryIds: text("related_entry_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArraySql),
    position: integer("position").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_entries_story_type_position_idx").on(
      table.storyId,
      table.type,
      table.position,
    ),
    check(
      "studio_entries_type_check",
      sql`${table.type} IN ('character', 'relationship', 'place', 'thing', 'lore', 'custom')`,
    ),
  ],
);

export const studioPlanItems = sqliteTable(
  "studio_plan_items",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(
      (): AnySQLiteColumn => studioPlanItems.id,
      {
        onDelete: "cascade",
      },
    ),
    kind: text("kind").$type<StudioPlanKind>().notNull(),
    position: integer("position").notNull().default(0),
    title: text("title").notNull().default(""),
    whatHappens: text("what_happens").notNull().default(""),
    howToWrite: text("how_to_write").notNull().default(""),
    craft: text("craft", { mode: "json" })
      .$type<Record<string, string>>()
      .notNull()
      .default(emptyJsonObjectSql),
    presentEntryIds: text("present_entry_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArraySql),
    contextPinnedEntryIds: text("context_pinned_entry_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArraySql),
    contextExcludedEntryIds: text("context_excluded_entry_ids", {
      mode: "json",
    })
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArraySql),
    authorFields: text("author_fields", { mode: "json" })
      .$type<StudioPlanField[]>()
      .notNull()
      .default(emptyJsonArraySql),
    origin: text("origin").$type<StudioPlanOrigin>().notNull().default("ai"),
    summary: text("summary").notNull().default(""),
    tension: integer("tension"),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_plan_items_story_parent_position_idx").on(
      table.storyId,
      table.parentId,
      table.position,
    ),
    check(
      "studio_plan_items_kind_check",
      sql`${table.kind} IN ('chapter', 'scene', 'moment')`,
    ),
    check(
      "studio_plan_items_origin_check",
      sql`${table.origin} IN ('ai', 'author')`,
    ),
    check(
      "studio_plan_items_tension_check",
      sql`${table.tension} IS NULL OR (${table.kind} = 'chapter' AND ${table.tension} BETWEEN 1 AND 10)`,
    ),
  ],
);

export const studioChanges = sqliteTable(
  "studio_changes",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    entryId: text("entry_id")
      .notNull()
      .references(() => studioEntries.id, { onDelete: "cascade" }),
    aboutEntryId: text("about_entry_id").references(() => studioEntries.id, {
      onDelete: "set null",
    }),
    aspect: text("aspect").$type<StudioAspect>().notNull(),
    mode: text("mode").$type<StudioChangeMode>().notNull().default("set"),
    value: text("value").notNull(),
    planItemId: text("plan_item_id")
      .notNull()
      .references(() => studioPlanItems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    source: text("source").$type<StudioChangeSource>().notNull(),
    status: text("status").$type<StudioChangeStatus>().notNull(),
    authorEdited: integer("author_edited", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_changes_story_plan_item_idx").on(
      table.storyId,
      table.planItemId,
    ),
    check("studio_changes_mode_check", sql`${table.mode} IN ('set', 'add')`),
    check(
      "studio_changes_source_check",
      sql`${table.source} IN ('planned', 'read-back', 'author')`,
    ),
    check(
      "studio_changes_status_check",
      sql`${table.status} IN ('planned', 'confirmed')`,
    ),
  ],
);

export const studioProse = sqliteTable(
  "studio_prose",
  {
    momentId: text("moment_id")
      .primaryKey()
      .references(() => studioPlanItems.id, { onDelete: "cascade" }),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull().default(""),
    origin: text("origin").$type<StudioProseOrigin>().notNull(),
    revision: integer("revision").notNull().default(0),
    wordCount: integer("word_count").notNull().default(0),
    // Hash of the markdown the read-back last ran against, so a stale async
    // result can be told apart from one for the current text.
    readBackSourceHash: text("read_back_source_hash").notNull().default(""),
    readBackSentenceHashes: text("read_back_sentence_hashes", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(emptyJsonArraySql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_prose_story_idx").on(table.storyId),
    check(
      "studio_prose_origin_check",
      sql`${table.origin} IN ('ai', 'author', 'ai-edited')`,
    ),
  ],
);

export const studioProseVersions = sqliteTable(
  "studio_prose_versions",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    momentId: text("moment_id")
      .notNull()
      .references(() => studioPlanItems.id, { onDelete: "cascade" }),
    markdown: text("markdown").notNull(),
    origin: text("origin").$type<StudioProseOrigin>().notNull(),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_prose_versions_moment_created_idx").on(
      table.momentId,
      table.createdAt,
    ),
    check(
      "studio_prose_versions_origin_check",
      sql`${table.origin} IN ('ai', 'author', 'ai-edited')`,
    ),
  ],
);

export const studioFlags = sqliteTable(
  "studio_flags",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    planItemId: text("plan_item_id")
      .notNull()
      .references(() => studioPlanItems.id, { onDelete: "cascade" }),
    kind: text("kind").$type<StudioFlagKind>().notNull(),
    payload: text("payload", { mode: "json" })
      .$type<StudioFlagPayload>()
      .notNull(),
    status: text("status").$type<StudioFlagStatus>().notNull().default("open"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    index("studio_flags_story_status_idx").on(table.storyId, table.status),
    check(
      "studio_flags_kind_check",
      sql`${table.kind} IN ('unplanned-change', 'missing-planned-change')`,
    ),
    check(
      "studio_flags_status_check",
      sql`${table.status} IN ('open', 'resolved', 'dismissed')`,
    ),
  ],
);

export const studioBundles = sqliteTable(
  "studio_bundles",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => studioStories.id, { onDelete: "cascade" }),
    // No CHECK: Phase 2 cascade fixes add a source without a table rebuild.
    source: text("source").$type<StudioBundleSource>().notNull(),
    // Informational links only. A bundle outlives the thread it came from.
    threadId: text("thread_id"),
    messageId: text("message_id"),
    generationId: text("generation_id").notNull(),
    summary: text("summary").notNull().default(""),
    operations: text("operations", { mode: "json" })
      .$type<StudioBundleOp[]>()
      .notNull()
      .default(emptyJsonArraySql),
    status: text("status")
      .$type<StudioBundleStatus>()
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(currentTimestampSql),
    updatedAt: text("updated_at").notNull().default(currentTimestampSql),
  },
  (table) => [
    uniqueIndex("studio_bundles_generation_unique").on(table.generationId),
    index("studio_bundles_story_status_idx").on(table.storyId, table.status),
    check(
      "studio_bundles_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'partially-accepted', 'rejected', 'undone')`,
    ),
  ],
);

export const studioStoriesRelations = relations(studioStories, ({ many }) => ({
  entries: many(studioEntries),
  planItems: many(studioPlanItems),
}));

export const studioEntriesRelations = relations(studioEntries, ({ one }) => ({
  story: one(studioStories, {
    fields: [studioEntries.storyId],
    references: [studioStories.id],
  }),
}));

export const studioPlanItemsRelations = relations(
  studioPlanItems,
  ({ one, many }) => ({
    story: one(studioStories, {
      fields: [studioPlanItems.storyId],
      references: [studioStories.id],
    }),
    parent: one(studioPlanItems, {
      fields: [studioPlanItems.parentId],
      references: [studioPlanItems.id],
      relationName: "studioPlanItemParent",
    }),
    children: many(studioPlanItems, { relationName: "studioPlanItemParent" }),
    changes: many(studioChanges),
    flags: many(studioFlags),
  }),
);

export const studioChangesRelations = relations(studioChanges, ({ one }) => ({
  planItem: one(studioPlanItems, {
    fields: [studioChanges.planItemId],
    references: [studioPlanItems.id],
  }),
  entry: one(studioEntries, {
    fields: [studioChanges.entryId],
    references: [studioEntries.id],
    relationName: "studioChangeEntry",
  }),
  aboutEntry: one(studioEntries, {
    fields: [studioChanges.aboutEntryId],
    references: [studioEntries.id],
    relationName: "studioChangeAboutEntry",
  }),
}));

export const studioProseRelations = relations(studioProse, ({ one }) => ({
  moment: one(studioPlanItems, {
    fields: [studioProse.momentId],
    references: [studioPlanItems.id],
  }),
}));

export const studioProseVersionsRelations = relations(
  studioProseVersions,
  ({ one }) => ({
    moment: one(studioPlanItems, {
      fields: [studioProseVersions.momentId],
      references: [studioPlanItems.id],
    }),
  }),
);

export const studioFlagsRelations = relations(studioFlags, ({ one }) => ({
  planItem: one(studioPlanItems, {
    fields: [studioFlags.planItemId],
    references: [studioPlanItems.id],
  }),
}));
