"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { patchStudioChange } from "@/lib/server/studio/repository-bible";

import { updateStudioChangeActionSchema } from "./_schemas";
import type { StudioChangeDto } from "./_types";

export const updateStudioChange = publicActionClient
  .metadata({ action: "studio-update-change" })
  .inputSchema(updateStudioChangeActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioChangeDto> =>
      getDb().transaction((tx) => patchStudioChange(tx, parsedInput)),
  );
