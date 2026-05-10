import { z } from "zod";

const storyCharacterSchema = z.object({
  id: z.string().trim().max(128, "Character id is too long.").optional(),
  name: z
    .string()
    .trim()
    .min(1, "Character name is required.")
    .max(120, "Character name must be 120 characters or fewer."),
  description: z.string().trim(),
});

const storyCharactersSchema = z
  .array(storyCharacterSchema)
  .max(100, "Stories can have up to 100 characters.");

const storyLocationSchema = z.object({
  id: z.string().trim().max(128, "Location id is too long.").optional(),
  name: z
    .string()
    .trim()
    .min(1, "Location name is required.")
    .max(120, "Location name must be 120 characters or fewer."),
  description: z.string().trim(),
});

const storyLocationsSchema = z
  .array(storyLocationSchema)
  .max(100, "Stories can have up to 100 locations.");

const storyStyleSchema = z.string().trim();

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
  locations: storyLocationsSchema.optional(),
  style: storyStyleSchema.optional(),
});
export const updateStoryFormSchema = createStoryFormSchema.extend({
  id: z.string().min(1, "Story id is required."),
});
export const updateStoryActionSchema = updateStoryFormSchema.extend({
  characters: storyCharactersSchema.optional(),
  locations: storyLocationsSchema.optional(),
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
