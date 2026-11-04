"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { restoreProseVersion } from "@/lib/server/studio/repository-prose";

import { restoreStudioProseVersionActionSchema } from "./_schemas";
import type { StudioProseDto } from "./_types";

export const restoreStudioProseVersion = publicActionClient
  .metadata({ action: "studio-restore-prose-version" })
  .inputSchema(restoreStudioProseVersionActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioProseDto> =>
      getDb().transaction((tx) => restoreProseVersion(tx, parsedInput)),
  );
