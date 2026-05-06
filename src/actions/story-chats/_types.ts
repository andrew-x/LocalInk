import type { StoryChatMessageRole } from "@/lib/drizzle/schema";

export type StoryChatVisibleMessageRole = Exclude<
  StoryChatMessageRole,
  "system"
>;

export type StoryChatListItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryChatVisibleMessage = {
  id: string;
  role: StoryChatVisibleMessageRole;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryChatDetail = StoryChatListItem & {
  messages: StoryChatVisibleMessage[];
};

export type PreparedStoryChatGeneration = {
  chat: StoryChatListItem;
  contextMessageId: string;
  generationId: string;
  messages: StoryChatVisibleMessage[];
  replaceAssistantMessageId?: string;
};

export type SavedStoryChatAssistantOutput = {
  chat: StoryChatListItem;
  message: StoryChatVisibleMessage;
};
