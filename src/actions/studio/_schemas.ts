import { z } from "zod";

import { storyGenerationModelSchema } from "@/lib/story-generation-models";
import {
  studioAspectSchema,
  studioCraftSchema,
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

export const createStudioStoryActionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  brainDump: z.string().max(40_000),
  voiceSamples: studioVoiceSamplesSchema.optional(),
});

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
});

export const updateStudioEntryActionSchema = z.object({
  ...storyIdField,
  entryId: id,
  expectedRevision: revisionSchema,
  patch: z
    .object({
      name: z.string().trim().min(1).max(200),
      summary: z.string().max(20_000),
      // The server stamps every submitted field as author-written.
      fields: z.record(
        z.string().min(1).max(64),
        z.object({
          value: z.string().max(20_000),
          author: z.enum(["ai", "author"]).optional(),
        }),
      ),
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
      tension: z.number().int().min(1).max(10).nullable(),
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

export const splitStudioMomentActionSchema = z.object({
  ...storyIdField,
  momentId: id,
  expectedRevision: revisionSchema,
  beforeMarkdown: markdownSchema,
  afterMarkdown: markdownSchema,
});

export const mergeStudioMomentActionSchema = z.object({
  ...storyIdField,
  momentId: id,
  expectedRevision: revisionSchema,
  previousExpectedRevision: revisionSchema,
});
