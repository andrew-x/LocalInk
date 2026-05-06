"use server";

import { runLoggedAction } from "@/lib/action";
import { loadStoryChat } from "@/lib/server/story-chat";

import { getStoryChatReadSchema } from "./_schemas";
import type { StoryChatDetail } from "./_types";

export async function getStoryChat(
  input: unknown,
): Promise<StoryChatDetail | null> {
  return runLoggedAction({ action: "get-story-chat" }, async () => {
    const parsedInput = getStoryChatReadSchema.parse(input);

    return loadStoryChat(parsedInput.storyId, parsedInput.chatId);
  });
}
