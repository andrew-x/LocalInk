"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { prepareStoryChatTurn as prepareStoryChatTurnData } from "@/lib/server/story-chat";

import { prepareStoryChatTurnActionSchema } from "./_schemas";
import type { PreparedStoryChatGeneration } from "./_types";

export const prepareStoryChatTurn = publicActionClient
  .metadata({ action: "prepare-story-chat-turn" })
  .inputSchema(prepareStoryChatTurnActionSchema)
  .action(async ({ parsedInput }): Promise<PreparedStoryChatGeneration> => {
    const preparedGeneration = await prepareStoryChatTurnData(parsedInput);

    revalidatePath(`/story/${parsedInput.storyId}`);

    return preparedGeneration;
  });
