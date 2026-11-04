"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { getProseVersionMarkdown } from "@/lib/server/studio/repository-prose";

import { getStudioProseVersionSchema } from "./_schemas";

export async function getStudioProseVersion(input: {
  storyId: string;
  versionId: string;
}): Promise<{ markdown: string }> {
  return runLoggedAction({ action: "studio-get-prose-version" }, async () => {
    const parsed = getStudioProseVersionSchema.safeParse(input);
    if (!parsed.success) {
      throw new ActionError(
        "BAD_REQUEST",
        "The saved version could not be found.",
      );
    }
    const { storyId, versionId } = parsed.data;
    return getDb().transaction((tx) =>
      getProseVersionMarkdown(tx, storyId, versionId),
    );
  });
}
