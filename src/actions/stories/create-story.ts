"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { stories } from "@/lib/drizzle/schema";
import { normalizeStoryCharacters } from "@/lib/server/story-characters";
import { normalizeStoryLocations } from "@/lib/server/story-locations";
import { generateId } from "@/lib/util";

import { createStoryActionSchema } from "./_schemas";
import type { StoryListItem } from "./_types";

export const createStory = publicActionClient
  .metadata({ action: "create-story" })
  .inputSchema(createStoryActionSchema)
  .action(async ({ parsedInput }): Promise<StoryListItem> => {
    const now = day().toISOString();
    const story = {
      id: generateId("story"),
      name: parsedInput.name,
      description: parsedInput.description,
      characters: normalizeStoryCharacters(parsedInput.characters ?? []),
      locations: normalizeStoryLocations(parsedInput.locations ?? []),
      style: parsedInput.style ?? "",
      createdAt: now,
      updatedAt: now,
    } satisfies typeof stories.$inferInsert;

    await getDb().insert(stories).values(story);
    revalidatePath("/");

    return {
      id: story.id,
      name: story.name,
      description: story.description,
      updatedAt: story.updatedAt,
    };
  });
