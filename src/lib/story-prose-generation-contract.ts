import { z } from "zod";

const MAX_CONTEXT_TEXT_LENGTH = 1_000_000;

const storyProseCharacterSchema = z.object({
  id: z.string().trim().max(128).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim(),
});

const storyProseStorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
});

const storyProseChapterSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  position: z.number().int().positive(),
  content: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
});

const storyProseRegenerationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fresh-alternative"),
  }),
  z.object({
    editInstructions: z.string().trim().min(1).max(1_000),
    mode: z.literal("revise-prior-draft"),
    priorDraft: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
  }),
]);

export const storyProseGenerationRequestSchema = z.object({
  story: storyProseStorySchema,
  style: z.string(),
  characters: z.array(storyProseCharacterSchema).max(100),
  chapters: z.array(storyProseChapterSchema).max(500),
  focusedChapter: storyProseChapterSchema,
  insertion: z.object({
    beforeText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    afterText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    atChapterEnd: z.boolean(),
  }),
  instructions: z.string().trim().max(2_000),
  approximateLength: z.union([z.literal(200), z.literal(400), z.literal(600)]),
  regeneration: storyProseRegenerationSchema.optional(),
});

export type StoryProseGenerationRequest = z.infer<
  typeof storyProseGenerationRequestSchema
>;
