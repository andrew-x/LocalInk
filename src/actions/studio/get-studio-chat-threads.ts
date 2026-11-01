"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { listStudioChatThreads } from "@/lib/server/studio/repository-chat";

import { getStudioChatThreadsSchema } from "./_schemas";
import type { StudioChatThreadDto } from "./_types";

/** Threads of one story, most recently active first. */
export async function getStudioChatThreads(input: {
  storyId: string;
}): Promise<StudioChatThreadDto[]> {
  return runLoggedAction({ action: "studio-chat-get-threads" }, async () => {
    const parsed = getStudioChatThreadsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ActionError("BAD_REQUEST", "The story id is not valid.");
    }
    return listStudioChatThreads(parsed.data.storyId);
  });
}
