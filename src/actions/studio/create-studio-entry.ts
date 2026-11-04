"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { insertStudioEntry } from "@/lib/server/studio/repository-bible";

import { createStudioEntryActionSchema } from "./_schemas";
import type { StudioEntryDto } from "./_types";

export const createStudioEntry = publicActionClient
  .metadata({ action: "studio-create-entry" })
  .inputSchema(createStudioEntryActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioEntryDto> =>
      getDb().transaction((tx) => insertStudioEntry(tx, parsedInput)),
  );
