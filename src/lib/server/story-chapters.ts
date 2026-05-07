import "server-only";

import { and, eq } from "drizzle-orm";

import type { StoryChapterItem } from "@/actions/stories/_types";
import type { LocalinkDb } from "@/lib/drizzle/db";
import { chapters } from "@/lib/drizzle/schema";

export const storyChapterSelectFields = {
  id: chapters.id,
  name: chapters.name,
  position: chapters.position,
  content: chapters.content,
  updatedAt: chapters.updatedAt,
};

export async function loadStoryChapterById(
  db: LocalinkDb,
  storyId: string,
  chapterId: string,
): Promise<StoryChapterItem | null> {
  const [chapter] = await db
    .select(storyChapterSelectFields)
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.storyId, storyId)))
    .limit(1);

  return chapter ?? null;
}
