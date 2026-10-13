import { z } from "zod";

import { storyProseGenerationRequestSchema } from "@/lib/story-prose-generation-contract";

export const storyPromptContextSchema = storyProseGenerationRequestSchema.omit({
  model: true,
  regeneration: true,
});

const storyPromptIdeaSchema = z.string().trim().min(1).max(180);

export const storyPromptSuggestionsRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z.object({
      operation: z.literal("ideas"),
      context: storyPromptContextSchema,
      previousIdeas: z.array(storyPromptIdeaSchema).max(3).optional(),
    }),
    z.object({
      operation: z.literal("expand"),
      context: storyPromptContextSchema,
      selectedIdea: storyPromptIdeaSchema,
    }),
  ],
);

export const storyPromptIdeasResponseSchema = z.object({
  ideas: z.array(storyPromptIdeaSchema).length(3),
});

export const storyPromptExpansionResponseSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
});

export type StoryPromptContext = z.infer<typeof storyPromptContextSchema>;
export type StoryPromptSuggestionsRequest = z.infer<
  typeof storyPromptSuggestionsRequestSchema
>;
