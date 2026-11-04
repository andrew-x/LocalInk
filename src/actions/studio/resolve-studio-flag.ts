"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { resolveStudioFlagInTx } from "@/lib/server/studio/read-back-apply";

import { resolveStudioFlagActionSchema } from "./_schemas";
import type { StudioFlagResolveResult } from "./_types";

export const resolveStudioFlag = publicActionClient
  .metadata({ action: "studio-resolve-flag" })
  .inputSchema(resolveStudioFlagActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioFlagResolveResult> =>
      getDb().transaction((tx) => resolveStudioFlagInTx(tx, parsedInput)),
  );
