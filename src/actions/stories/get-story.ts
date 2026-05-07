"use server";

import { asc, eq } from "drizzle-orm";

import { runLoggedAction } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { chapters, stories } from "@/lib/drizzle/schema";
import { storyChapterSelectFields } from "@/lib/server/story-chapters";
import { normalizeStoryCharacters } from "@/lib/server/story-characters";

import type { StoryEditorData } from "./_types";

export async function getStory(
  storyId: string,
): Promise<StoryEditorData | null> {
  return runLoggedAction({ action: "get-story" }, async () => {
    const db = getDb();
    const [story] = await db
      .select({
        id: stories.id,
        name: stories.name,
        description: stories.description,
        characters: stories.characters,
        style: stories.style,
        updatedAt: stories.updatedAt,
      })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);

    if (!story) {
      return null;
    }

    const storyChapters = await db
      .select(storyChapterSelectFields)
      .from(chapters)
      .where(eq(chapters.storyId, storyId))
      .orderBy(asc(chapters.position));

    return {
      ...story,
      characters: normalizeStoryCharacters(story.characters),
      chapters: storyChapters,
    };
  });
}
