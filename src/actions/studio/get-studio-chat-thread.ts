"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { loadStudioChatThread } from "@/lib/server/studio/repository-chat";

import { studioChatThreadActionSchema } from "./_schemas";
import type { StudioChatThreadDetail } from "./_types";

/** One thread's messages and the bundles they proposed; null if gone. */
export async function getStudioChatThread(input: {
  storyId: string;
  threadId: string;
}): Promise<StudioChatThreadDetail | null> {
  return runLoggedAction({ action: "studio-chat-get-thread" }, async () => {
    const parsed = studioChatThreadActionSchema.safeParse(input);
    if (!parsed.success) {
      throw new ActionError("BAD_REQUEST", "This chat could not be found.");
    }
    return loadStudioChatThread(parsed.data.storyId, parsed.data.threadId);
  });
}
