"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import {
  chatStageBinding,
  discardStudioChatTurn as discardTurnInTx,
} from "@/lib/server/studio/repository-chat";
import { dropStudioStage } from "@/lib/server/studio/staging";

import { studioChatTurnActionSchema } from "./_schemas";
import type { StudioChatDiscardResult } from "./_types";

export const discardStudioChatTurn = publicActionClient
  .metadata({ action: "studio-chat-discard-turn" })
  .inputSchema(studioChatTurnActionSchema)
  .action(async ({ parsedInput }): Promise<StudioChatDiscardResult> => {
    const result = getDb().transaction((tx) =>
      discardTurnInTx(tx, parsedInput),
    );
    // A reply still streaming (or staged) for this turn can no longer be
    // saved once its prepared message is gone.
    dropStudioStage(chatStageBinding(parsedInput));
    return result;
  });
