import { z } from "zod";

const MAX_CONTEXT_TEXT_LENGTH = 1_000_000;

const storyProseCharacterSchema = z.object({
  id: z.string().trim().max(128).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000),
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
  summary: z.string().max(8_000),
  content: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
});

export const storyProseGenerationRequestSchema = z.object({
  story: storyProseStorySchema,
  style: z.string().max(8_000),
  characters: z.array(storyProseCharacterSchema).max(100),
  focusedChapter: storyProseChapterSchema,
  previousChapter: storyProseChapterSchema.optional(),
  nextChapter: storyProseChapterSchema.optional(),
  insertion: z.object({
    beforeText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    afterText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    atChapterEnd: z.boolean(),
  }),
  instructions: z.string().trim().max(2_000),
  approximateLength: z.union([z.literal(400), z.literal(600), z.literal(800)]),
});

export type StoryProseGenerationRequest = z.infer<
  typeof storyProseGenerationRequestSchema
>;
