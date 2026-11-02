import { z } from "zod";

import { storyGenerationModelSchema } from "@/lib/story-generation-models";
import { STUDIO_BUNDLE_MAX_OPS } from "@/lib/studio/bundle-contract";
import { STUDIO_CHAT_MAX_MESSAGE_CHARS } from "@/lib/studio/chat-contract";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  studioAspectSchema,
  studioChangeModeSchema,
  studioCraftSchema,
  studioEntryFieldSchema,
  studioEntryFieldsSchema,
  studioIdListSchema,
  studioStyleSchema,
  studioVoiceSamplesSchema,
} from "@/lib/studio/contracts";

const id = z.string().trim().min(1).max(128);
const nullableId = id.nullable();
const storyIdField = { storyId: id };
const entryTypeSchema = z.enum([
  "character",
  "relationship",
  "place",
  "thing",
  "lore",
  "custom",
]);
const planKindSchema = z.enum(["chapter", "scene", "moment"]);
const structureTemplateSchema = z.enum([
  "romance",
  "coming-of-age",
  "quiet",
  "freeform",
]);
const revisionSchema = z.number().int().min(0);
const MAX_MARKDOWN_CHARS = 200_000;
const markdownSchema = z.string().max(MAX_MARKDOWN_CHARS);

export const getStudioWorkspaceSchema = z.object(storyIdField);

export const createStudioStoryFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  brainDump: z
    .string()
    .trim()
    .min(1, "Add a brain dump so the studio has something to plan from.")
    .max(40_000, "The brain dump must be 40,000 characters or fewer."),
  voiceSamples: studioVoiceSamplesSchema.optional(),
});

export type CreateStudioStoryFormValues = z.infer<
  typeof createStudioStoryFormSchema
>;

export const createStudioStoryActionSchema = createStudioStoryFormSchema.extend(
  {
    // The server accepts an empty dump; only the form requires one.
    brainDump: z.string().max(40_000),
  },
);

export const updateStudioStoryActionSchema = z.object({
  ...storyIdField,
  patch: z
    .object({
      title: z.string().trim().min(1).max(120),
      overview: z.string().max(20_000),
      instructions: z.string().max(8000),
      style: studioStyleSchema,
      theme: z.string().max(2000),
      structureTemplate: structureTemplateSchema,
      structureNotes: z.string().max(8000),
      voiceSamples: studioVoiceSamplesSchema,
      proseModel: storyGenerationModelSchema,
      // Only configured profiles, all of which support tool calling.
      chatModel: storyGenerationModelSchema,
    })
    .partial(),
});

export const deleteStudioStoryActionSchema = z.object(storyIdField);

export const createStudioEntryActionSchema = z.object({
  ...storyIdField,
  type: entryTypeSchema,
  name: z.string().trim().min(1, "Name is required.").max(200),
  customTypeLabel: z.string().trim().max(60).optional(),
  relatedEntryIds: studioIdListSchema.optional(),
  fields: z
    .array(
      studioEntryFieldSchema.pick({
        label: true,
        value: true,
        steerOnly: true,
        backstoryOnly: true,
      }),
    )
    .max(STUDIO_MAX_ENTRY_FIELDS)
    .optional(),
});

export const updateStudioEntryActionSchema = z.object({
  ...storyIdField,
  entryId: id,
  expectedRevision: revisionSchema,
  patch: z
    .object({
      name: z.string().trim().min(1).max(200),
      summary: z.string().max(20_000),
      // The full desired list; the server stamps authorship by comparison.
      fields: studioEntryFieldsSchema,
      relatedEntryIds: studioIdListSchema,
      customTypeLabel: z.string().trim().max(60),
    })
    .partial(),
});

export const deleteStudioEntryActionSchema = z.object({
  ...storyIdField,
  entryId: id,
});

export const createStudioChangeActionSchema = z.object({
  ...storyIdField,
  entryId: id,
  aspect: studioAspectSchema,
  mode: studioChangeModeSchema,
  aboutEntryId: nullableId.optional(),
  value: z.string().max(4000),
  planItemId: id,
});

export const updateStudioChangeActionSchema = z.object({
  ...storyIdField,
  changeId: id,
  patch: z
    .object({
      aspect: studioAspectSchema,
      mode: studioChangeModeSchema,
      aboutEntryId: nullableId,
      value: z.string().max(4000),
      planItemId: id,
    })
    .partial(),
});

export const deleteStudioChangeActionSchema = z.object({
  ...storyIdField,
  changeId: id,
});

export const createStudioPlanItemActionSchema = z.object({
  ...storyIdField,
  kind: planKindSchema,
  parentId: nullableId,
  afterItemId: nullableId.optional(),
  title: z.string().trim().max(200).optional(),
});

export const updateStudioPlanItemActionSchema = z.object({
  ...storyIdField,
  itemId: id,
  expectedRevision: revisionSchema,
  patch: z
    .object({
      title: z.string().max(200),
      whatHappens: z.string().max(20_000),
      howToWrite: z.string().max(20_000),
      craft: studioCraftSchema,
      presentEntryIds: studioIdListSchema,
      contextPinnedEntryIds: studioIdListSchema,
      contextExcludedEntryIds: studioIdListSchema,
    })
    .partial(),
});

export const moveStudioPlanItemActionSchema = z.object({
  ...storyIdField,
  itemId: id,
  newParentId: nullableId,
  newIndex: z.number().int().min(0),
});

export const deleteStudioPlanItemActionSchema = z.object({
  ...storyIdField,
  itemId: id,
});

export const restoreStudioPlanItemActionSchema = z.object({
  ...storyIdField,
  undoToken: id,
});

export const updateStudioMomentProseActionSchema = z.object({
  ...storyIdField,
  momentId: id,
  markdown: markdownSchema,
  expectedRevision: revisionSchema,
});

export const snapshotStudioMomentProseActionSchema = z.object({
  ...storyIdField,
  momentId: id,
});

export const getStudioProseVersionsSchema = z.object({
  ...storyIdField,
  momentId: id,
});

export const getStudioProseVersionSchema = z.object({
  ...storyIdField,
  versionId: id,
});

export const restoreStudioProseVersionActionSchema = z.object({
  ...storyIdField,
  versionId: id,
  expectedRevision: revisionSchema,
});

export const applyStudioPlanActionSchema = z.object({
  ...storyIdField,
  generationId: id,
  mode: z.enum(["initial", "flesh-out"]),
  targetItemId: id.optional(),
});

export const keepStudioSceneDraftActionSchema = z.object({
  ...storyIdField,
  sceneId: id,
  beats: z
    .array(
      z.object({
        momentId: id,
        generationId: id,
        expectedRevision: revisionSchema,
      }),
    )
    .min(1)
    .max(50),
});

export const applyStudioReadBackActionSchema = z.object({
  ...storyIdField,
  momentId: id,
  generationId: id,
});

export const applyStudioRefreshedFieldsActionSchema = z.object({
  ...storyIdField,
  entryId: id,
  generationId: id,
});

export const resolveStudioFlagActionSchema = z.object({
  ...storyIdField,
  flagId: id,
  resolution: z.enum(["record", "dismiss", "drop"]),
});

export const resolveStudioBundleActionSchema = z.object({
  ...storyIdField,
  bundleId: id,
  decision: z.enum(["accept", "reject", "undo"]),
  /**
   * Accept and reject: the ops to decide (accept also brings the pending
   * creates they need; reject also dismisses the pending ops that need
   * them). Null means every pending op. Undo ignores it.
   */
  opIds: z.array(id).min(1).max(STUDIO_BUNDLE_MAX_OPS).nullable(),
});

export const checkStudioBundleSelectionSchema = z.object({
  ...storyIdField,
  bundleId: id,
  /** The ops the author would accept; null means every pending op. */
  opIds: z.array(id).min(1).max(STUDIO_BUNDLE_MAX_OPS).nullable(),
});

/** The chat composer's own field; the turn continues past the action. */
export const studioChatComposerFormSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(
      STUDIO_CHAT_MAX_MESSAGE_CHARS,
      `Messages must be ${STUDIO_CHAT_MAX_MESSAGE_CHARS.toLocaleString("en-US")} characters or fewer.`,
    ),
});

export type StudioChatComposerFormValues = z.infer<
  typeof studioChatComposerFormSchema
>;

export const prepareStudioChatTurnActionSchema =
  studioChatComposerFormSchema.extend({
    ...storyIdField,
    /** null starts a new thread titled from the message. */
    threadId: nullableId,
  });

/** Save and discard address a turn by ids only, never by text. */
export const studioChatTurnActionSchema = z.object({
  ...storyIdField,
  threadId: id,
  generationId: id,
});

export const getStudioChatThreadsSchema = z.object(storyIdField);

export const studioChatThreadActionSchema = z.object({
  ...storyIdField,
  threadId: id,
});

export const resolveStudioEntrySuggestionActionSchema = z.object({
  ...storyIdField,
  suggestionId: id,
  decision: z.enum(["add", "ignore"]),
});
