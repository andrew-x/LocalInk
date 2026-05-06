"use server";

import { publicActionClient } from "@/lib/action";
import { prepareStoryChatRegeneration as prepareStoryChatRegenerationData } from "@/lib/server/story-chat";

import { prepareStoryChatRegenerationActionSchema } from "./_schemas";
import type { PreparedStoryChatGeneration } from "./_types";

export const prepareStoryChatRegeneration = publicActionClient
  .metadata({ action: "prepare-story-chat-regeneration" })
  .inputSchema(prepareStoryChatRegenerationActionSchema)
  .action(async ({ parsedInput }): Promise<PreparedStoryChatGeneration> => {
    return prepareStoryChatRegenerationData(parsedInput);
  });
