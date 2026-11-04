"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { checkStudioBundleSelection as checkSelectionInTx } from "@/lib/server/studio/bundles";

import { checkStudioBundleSelectionSchema } from "./_schemas";
import type { StudioBundleSelectionCheck } from "./_types";

export async function checkStudioBundleSelection(input: {
  storyId: string;
  bundleId: string;
  opIds: string[] | null;
}): Promise<StudioBundleSelectionCheck> {
  return runLoggedAction(
    { action: "studio-check-bundle-selection" },
    async () => {
      const parsed = checkStudioBundleSelectionSchema.safeParse(input);
      if (!parsed.success) {
        throw new ActionError(
          "BAD_REQUEST",
          "These proposed changes could not be found.",
        );
      }
      return getDb().transaction((tx) => checkSelectionInTx(tx, parsed.data));
    },
  );
}
