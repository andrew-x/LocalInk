"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { saveMomentProse } from "@/lib/server/studio/repository-prose";

import { updateStudioMomentProseActionSchema } from "./_schemas";
import type { StudioProseDto } from "./_types";

export const updateStudioMomentProse = publicActionClient
  .metadata({ action: "studio-update-moment-prose" })
  .inputSchema(updateStudioMomentProseActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioProseDto> =>
      getDb().transaction((tx) => saveMomentProse(tx, parsedInput)),
  );
