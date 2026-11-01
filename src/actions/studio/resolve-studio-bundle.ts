"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { resolveStudioBundle as resolveBundleInTx } from "@/lib/server/studio/bundles";

import { resolveStudioBundleActionSchema } from "./_schemas";
import type { StudioBundleResolution } from "./_types";

export const resolveStudioBundle = publicActionClient
  .metadata({ action: "studio-resolve-bundle" })
  .inputSchema(resolveStudioBundleActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioBundleResolution> =>
      getDb().transaction((tx) => resolveBundleInTx(tx, parsedInput)),
  );
