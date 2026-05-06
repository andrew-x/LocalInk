"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { saveStoryChatAssistantOutput as saveStoryChatAssistantOutputData } from "@/lib/server/story-chat";

import { saveStoryChatAssistantOutputActionSchema } from "./_schemas";
import type { SavedStoryChatAssistantOutput } from "./_types";

export const saveStoryChatAssistantOutput = publicActionClient
  .metadata({ action: "save-story-chat-assistant-output" })
  .inputSchema(saveStoryChatAssistantOutputActionSchema)
  .action(async ({ parsedInput }): Promise<SavedStoryChatAssistantOutput> => {
    const savedOutput = await saveStoryChatAssistantOutputData(parsedInput);

    revalidatePath(`/story/${parsedInput.storyId}`);

    return savedOutput;
  });
