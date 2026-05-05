"use server";

import { desc } from "drizzle-orm";

import { runLoggedAction } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { stories } from "@/lib/drizzle/schema";

import type { StoryListItem } from "./_types";

export async function getStories(): Promise<StoryListItem[]> {
  return runLoggedAction({ action: "get-stories" }, async () =>
    getDb()
      .select({
        id: stories.id,
        name: stories.name,
        description: stories.description,
        updatedAt: stories.updatedAt,
      })
      .from(stories)
      .orderBy(desc(stories.updatedAt), desc(stories.createdAt)),
  );
}
