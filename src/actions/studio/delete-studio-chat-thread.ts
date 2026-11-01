"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { deleteStudioChatThread as deleteThreadInTx } from "@/lib/server/studio/repository-chat";

import { studioChatThreadActionSchema } from "./_schemas";

export const deleteStudioChatThread = publicActionClient
  .metadata({ action: "studio-chat-delete-thread" })
  .inputSchema(studioChatThreadActionSchema)
  .action(
    async ({ parsedInput }): Promise<{ deleted: boolean }> =>
      getDb().transaction((tx) => deleteThreadInTx(tx, parsedInput)),
  );
