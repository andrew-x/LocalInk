"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { resolveStudioEntrySuggestionInTx } from "@/lib/server/studio/repository-entry-suggestions";

import { resolveStudioEntrySuggestionActionSchema } from "./_schemas";
import type { StudioEntrySuggestionResolveResult } from "./_types";

export const resolveStudioEntrySuggestion = publicActionClient
  .metadata({ action: "studio-resolve-entry-suggestion" })
  .inputSchema(resolveStudioEntrySuggestionActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioEntrySuggestionResolveResult> =>
      getDb().transaction((tx) =>
        resolveStudioEntrySuggestionInTx(tx, parsedInput),
      ),
  );
