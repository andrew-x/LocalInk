"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import {
  chatStageBinding,
  saveStudioChatTurn as saveTurnInTx,
} from "@/lib/server/studio/repository-chat";
import { dropStudioStage } from "@/lib/server/studio/staging";

import { studioChatTurnActionSchema } from "./_schemas";
import type { StudioChatSavedTurn } from "./_types";

export const saveStudioChatTurn = publicActionClient
  .metadata({ action: "studio-chat-save-turn" })
  .inputSchema(studioChatTurnActionSchema)
  .action(async ({ parsedInput }): Promise<StudioChatSavedTurn> => {
    const saved = getDb().transaction((tx) => saveTurnInTx(tx, parsedInput));
    dropStudioStage(chatStageBinding(parsedInput));
    return saved;
  });
