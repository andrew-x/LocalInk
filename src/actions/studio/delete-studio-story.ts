"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";

import { studioStories } from "@/lib/drizzle/schema";
import { requireStudioStory } from "@/lib/server/studio/repository";

import { deleteStudioStoryActionSchema } from "./_schemas";

export const deleteStudioStory = publicActionClient
  .metadata({ action: "studio-delete-story" })
  .inputSchema(deleteStudioStoryActionSchema)
  .action(async ({ parsedInput }): Promise<{ storyId: string }> => {
    getDb().transaction((tx) => {
      requireStudioStory(tx, parsedInput.storyId);
      // Foreign keys cascade every studio table.
      tx.delete(studioStories)
        .where(eq(studioStories.id, parsedInput.storyId))
        .run();
    });
    revalidatePath("/studio");
    return { storyId: parsedInput.storyId };
  });
