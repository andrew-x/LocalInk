import { z } from "zod";

const storyCharacterSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Character name is required.")
    .max(120, "Character name must be 120 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(1000, "Character description must be 1000 characters or fewer."),
});

const storyCharactersSchema = z
  .array(storyCharacterSchema)
  .max(100, "Stories can have up to 100 characters.");

const storyStyleSchema = z
  .string()
  .trim()
  .max(4000, "Style must be 4000 characters or fewer.");

export const createStoryFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Story name is required.")
    .max(120, "Story name must be 120 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(600, "Description must be 600 characters or fewer."),
});

export const createStoryActionSchema = createStoryFormSchema.extend({
  characters: storyCharactersSchema.optional(),
  style: storyStyleSchema.optional(),
});
export const updateStoryFormSchema = createStoryFormSchema.extend({
  id: z.string().min(1, "Story id is required."),
});
export const updateStoryActionSchema = updateStoryFormSchema.extend({
  characters: storyCharactersSchema.optional(),
  style: storyStyleSchema.optional(),
});
export const deleteStoryActionSchema = z.object({
  id: z.string().min(1, "Story id is required."),
});

export const createChapterActionSchema = z.object({
  storyId: z.string().min(1, "Story id is required."),
});

export const updateChapterContentActionSchema = z.object({
  storyId: z.string().min(1, "Story id is required."),
  chapterId: z.string().min(1, "Chapter id is required."),
  content: z.string(),
});

export const updateChapterTitleActionSchema = z.object({
  storyId: z.string().min(1, "Story id is required."),
  chapterId: z.string().min(1, "Chapter id is required."),
  name: z
    .string()
    .trim()
    .min(1, "Chapter title is required.")
    .max(120, "Chapter title must be 120 characters or fewer."),
});

export const deleteChapterActionSchema = z.object({
  storyId: z.string().min(1, "Story id is required."),
  chapterId: z.string().min(1, "Chapter id is required."),
});

export type CreateStoryFormValues = z.infer<typeof createStoryFormSchema>;
export type UpdateStoryFormValues = z.infer<typeof updateStoryFormSchema>;
