"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { insertStudioChange } from "@/lib/server/studio/repository-bible";

import { createStudioChangeActionSchema } from "./_schemas";
import type { StudioChangeDto } from "./_types";

export const createStudioChange = publicActionClient
  .metadata({ action: "studio-create-change" })
  .inputSchema(createStudioChangeActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioChangeDto> =>
      getDb().transaction((tx) => insertStudioChange(tx, parsedInput)),
  );
