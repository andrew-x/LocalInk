"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { patchStudioStory } from "@/lib/server/studio/repository-bible";

import { updateStudioStoryActionSchema } from "./_schemas";
import type { StudioStoryDto } from "./_types";

export const updateStudioStory = publicActionClient
  .metadata({ action: "studio-update-story" })
  .inputSchema(updateStudioStoryActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioStoryDto> =>
      getDb().transaction((tx) =>
        patchStudioStory(tx, parsedInput.storyId, parsedInput.patch),
      ),
  );
