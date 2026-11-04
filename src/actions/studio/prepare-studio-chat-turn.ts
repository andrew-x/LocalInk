"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { prepareStudioChatTurn as prepareTurnInTx } from "@/lib/server/studio/repository-chat";

import { prepareStudioChatTurnActionSchema } from "./_schemas";
import type { StudioChatPreparedTurn } from "./_types";

export const prepareStudioChatTurn = publicActionClient
  .metadata({ action: "studio-chat-prepare-turn" })
  .inputSchema(prepareStudioChatTurnActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioChatPreparedTurn> =>
      getDb().transaction((tx) => prepareTurnInTx(tx, parsedInput)),
  );
