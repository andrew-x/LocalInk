"use server";

import { runLoggedAction } from "@/lib/action";
import { listStoryChats } from "@/lib/server/story-chat";

import { getStoryChatsReadSchema } from "./_schemas";
import type { StoryChatListItem } from "./_types";

export async function getStoryChats(
  input: unknown,
): Promise<StoryChatListItem[]> {
  return runLoggedAction({ action: "get-story-chats" }, async () => {
    const parsedInput = getStoryChatsReadSchema.parse(input);

    return listStoryChats(parsedInput.storyId);
  });
}
