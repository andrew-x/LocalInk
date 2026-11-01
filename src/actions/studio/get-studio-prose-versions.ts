"use server";

import { runLoggedAction } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { listProseVersions } from "@/lib/server/studio/repository-prose";

import { getStudioProseVersionsSchema } from "./_schemas";
import type { StudioProseVersionListItem } from "./_types";

export async function getStudioProseVersions(input: {
  storyId: string;
  momentId: string;
}): Promise<StudioProseVersionListItem[]> {
  return runLoggedAction({ action: "studio-get-prose-versions" }, async () => {
    const { storyId, momentId } = getStudioProseVersionsSchema.parse(input);
    return getDb().transaction((tx) =>
      listProseVersions(tx, storyId, momentId),
    );
  });
}
