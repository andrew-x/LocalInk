"use server";

import { revalidatePath } from "next/cache";
import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { insertStudioStory } from "@/lib/server/studio/repository-bible";

import { createStudioStoryActionSchema } from "./_schemas";
import type { StudioStoryDto } from "./_types";

export const createStudioStory = publicActionClient
  .metadata({ action: "studio-create-story" })
  .inputSchema(createStudioStoryActionSchema)
  .action(async ({ parsedInput }): Promise<StudioStoryDto> => {
    const story = getDb().transaction((tx) =>
      insertStudioStory(tx, parsedInput),
    );
    revalidatePath("/studio");
    return story;
  });
