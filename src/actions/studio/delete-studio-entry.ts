"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { removeStudioEntry } from "@/lib/server/studio/repository-bible";

import { deleteStudioEntryActionSchema } from "./_schemas";
import type { StudioFlagDto } from "./_types";

export const deleteStudioEntry = publicActionClient
  .metadata({ action: "studio-delete-entry" })
  .inputSchema(deleteStudioEntryActionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{ entryId: string; flags: StudioFlagDto[] }> => {
      const { flags } = getDb().transaction((tx) =>
        removeStudioEntry(tx, parsedInput.storyId, parsedInput.entryId),
      );
      return { entryId: parsedInput.entryId, flags };
    },
  );
