"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { listProseVersions } from "@/lib/server/studio/repository-prose";

import { getStudioProseVersionsSchema } from "./_schemas";
import type { StudioProseVersionListItem } from "./_types";

export async function getStudioProseVersions(input: {
  storyId: string;
  momentId: string;
}): Promise<StudioProseVersionListItem[]> {
  return runLoggedAction({ action: "studio-get-prose-versions" }, async () => {
    const parsed = getStudioProseVersionsSchema.safeParse(input);
    if (!parsed.success) {
      throw new ActionError("BAD_REQUEST", "The moment could not be found.");
    }
    const { storyId, momentId } = parsed.data;
    return getDb().transaction((tx) =>
      listProseVersions(tx, storyId, momentId),
    );
  });
}
