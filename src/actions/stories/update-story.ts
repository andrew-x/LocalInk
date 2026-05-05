"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { stories } from "@/lib/drizzle/schema";

import { updateStoryActionSchema } from "./_schemas";
import type { StoryUpdateResult } from "./_types";

export const updateStory = publicActionClient
  .metadata({ action: "update-story" })
  .inputSchema(updateStoryActionSchema)
  .action(async ({ parsedInput }): Promise<StoryUpdateResult> => {
    const now = day().toISOString();
    const storyUpdates: Partial<typeof stories.$inferInsert> = {
      name: parsedInput.name,
      description: parsedInput.description,
      updatedAt: now,
    };

    if (parsedInput.characters !== undefined) {
      storyUpdates.characters = parsedInput.characters;
    }

    if (parsedInput.style !== undefined) {
      storyUpdates.style = parsedInput.style;
    }

    const [story] = await getDb()
      .update(stories)
      .set(storyUpdates)
      .where(eq(stories.id, parsedInput.id))
      .returning({
        id: stories.id,
        name: stories.name,
        description: stories.description,
        characters: stories.characters,
        style: stories.style,
        updatedAt: stories.updatedAt,
      });

    if (!story) {
      throw new ActionError("BAD_REQUEST", "The story could not be found.");
    }

    revalidatePath("/");
    revalidatePath(`/story/${story.id}`);

    return story;
  });
