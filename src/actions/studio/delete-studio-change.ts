"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { removeStudioChange } from "@/lib/server/studio/repository-bible";

import { deleteStudioChangeActionSchema } from "./_schemas";

export const deleteStudioChange = publicActionClient
  .metadata({ action: "studio-delete-change" })
  .inputSchema(deleteStudioChangeActionSchema)
  .action(async ({ parsedInput }): Promise<{ changeId: string }> => {
    getDb().transaction((tx) =>
      removeStudioChange(tx, parsedInput.storyId, parsedInput.changeId),
    );
    return { changeId: parsedInput.changeId };
  });
