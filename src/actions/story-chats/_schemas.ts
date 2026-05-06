import { z } from "zod";

const idSchema = z.string().trim().min(1);

export const storyChatUserMessageSchema = z
  .string()
  .trim()
  .min(1, "Message is required.")
  .max(4_000, "Message must be 4000 characters or fewer.");

export const storyChatAssistantMessageSchema = z
  .string()
  .trim()
  .min(1, "Assistant output is required.")
  .max(200_000, "Assistant output is too long.");

export const getStoryChatsReadSchema = z.object({
  storyId: idSchema,
});

export const getStoryChatReadSchema = z.object({
  storyId: idSchema,
  chatId: idSchema,
});

export const prepareStoryChatTurnActionSchema = z.object({
  storyId: idSchema,
  chatId: idSchema.nullish(),
  content: storyChatUserMessageSchema,
});

export const prepareStoryChatRegenerationActionSchema = z.object({
  storyId: idSchema,
  chatId: idSchema,
  assistantMessageId: idSchema,
});

export const saveStoryChatAssistantOutputActionSchema = z.object({
  storyId: idSchema,
  chatId: idSchema,
  generationId: idSchema,
  contextMessageId: idSchema,
  replaceAssistantMessageId: idSchema.optional(),
  content: storyChatAssistantMessageSchema,
});
