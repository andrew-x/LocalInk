"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { snapshotMomentProse } from "@/lib/server/studio/repository-prose";

import { snapshotStudioMomentProseActionSchema } from "./_schemas";

export const snapshotStudioMomentProse = publicActionClient
  .metadata({ action: "studio-snapshot-moment-prose" })
  .inputSchema(snapshotStudioMomentProseActionSchema)
  .action(
    async ({ parsedInput }): Promise<{ created: boolean }> =>
      getDb().transaction((tx) =>
        snapshotMomentProse(tx, parsedInput.storyId, parsedInput.momentId),
      ),
  );
