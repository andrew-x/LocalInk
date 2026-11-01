"use server";

import { runLoggedAction } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { getProseVersionMarkdown } from "@/lib/server/studio/repository-prose";

import { getStudioProseVersionSchema } from "./_schemas";

export async function getStudioProseVersion(input: {
  storyId: string;
  versionId: string;
}): Promise<{ markdown: string }> {
  return runLoggedAction({ action: "studio-get-prose-version" }, async () => {
    const { storyId, versionId } = getStudioProseVersionSchema.parse(input);
    return getDb().transaction((tx) =>
      getProseVersionMarkdown(tx, storyId, versionId),
    );
  });
}
