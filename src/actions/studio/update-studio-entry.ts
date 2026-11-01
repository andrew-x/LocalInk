"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { patchStudioEntry } from "@/lib/server/studio/repository-bible";

import { updateStudioEntryActionSchema } from "./_schemas";
import type { StudioEntryDto } from "./_types";

export const updateStudioEntry = publicActionClient
  .metadata({ action: "studio-update-entry" })
  .inputSchema(updateStudioEntryActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioEntryDto> =>
      getDb().transaction((tx) => patchStudioEntry(tx, parsedInput)),
  );
