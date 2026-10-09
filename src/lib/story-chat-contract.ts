import { z } from "zod";
import {
  DEFAULT_STORY_GENERATION_MODEL,
  storyGenerationModelSchema,
} from "@/lib/story-generation-models";
import { manuscriptSnapshotSchema } from "@/lib/story-manuscript-contract";

const idSchema = z.string().trim().min(1);

export const storyChatStreamRequestSchema = z.object({
  model: storyGenerationModelSchema.default(DEFAULT_STORY_GENERATION_MODEL),
  storyId: idSchema,
  chatId: idSchema,
  generationId: idSchema,
  contextMessageId: idSchema,
  replaceAssistantMessageId: idSchema.optional(),
  manuscript: manuscriptSnapshotSchema,
});

export type StoryChatStreamRequest = z.infer<
  typeof storyChatStreamRequestSchema
>;
