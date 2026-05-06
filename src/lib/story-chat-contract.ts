import { z } from "zod";

const idSchema = z.string().trim().min(1);

export const storyChatStreamRequestSchema = z.object({
  storyId: idSchema,
  chatId: idSchema,
  generationId: idSchema,
  contextMessageId: idSchema,
  replaceAssistantMessageId: idSchema.optional(),
});

export type StoryChatStreamRequest = z.infer<
  typeof storyChatStreamRequestSchema
>;
