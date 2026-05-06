"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { EMPTY_CHAPTER_CONTENT_HASH } from "@/lib/chapter-content-hash";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters, stories } from "@/lib/drizzle/schema";
import { generateId } from "@/lib/util";

import { createChapterActionSchema } from "./_schemas";
import type { StoryChapterItem } from "./_types";

export const createChapter = publicActionClient
  .metadata({ action: "create-chapter" })
  .inputSchema(createChapterActionSchema)
  .action(async ({ parsedInput }): Promise<StoryChapterItem> => {
    const db = getDb();
    const [story] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, parsedInput.storyId))
      .limit(1);

    if (!story) {
      throw new ActionError("BAD_REQUEST", "The story could not be found.");
    }

    const [lastChapter] = await db
      .select({ position: chapters.position })
      .from(chapters)
      .where(eq(chapters.storyId, parsedInput.storyId))
      .orderBy(desc(chapters.position))
      .limit(1);

    const now = day().toISOString();
    const position = (lastChapter?.position ?? 0) + 1;
    const chapter = {
      id: generateId("chapter"),
      storyId: parsedInput.storyId,
      name: `Chapter ${position}`,
      position,
      content: "",
      indexedHash: EMPTY_CHAPTER_CONTENT_HASH,
      indexedAt: null,
      summary: "",
      updatedAt: now,
    } satisfies typeof chapters.$inferInsert;

    await db.insert(chapters).values(chapter);
    await db
      .update(stories)
      .set({ updatedAt: now })
      .where(eq(stories.id, parsedInput.storyId));

    revalidatePath("/");
    revalidatePath(`/story/${parsedInput.storyId}`);

    return {
      id: chapter.id,
      name: chapter.name,
      position: chapter.position,
      content: chapter.content,
      indexedHash: chapter.indexedHash,
      indexedAt: chapter.indexedAt,
      summary: chapter.summary,
      updatedAt: chapter.updatedAt,
    };
  });
