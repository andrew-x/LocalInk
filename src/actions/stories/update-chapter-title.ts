"use server";

import { and, eq } from "drizzle-orm";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters, stories } from "@/lib/drizzle/schema";
import { storyChapterSelectFields } from "@/lib/server/story-chapters";

import { updateChapterTitleActionSchema } from "./_schemas";
import type { StoryChapterItem } from "./_types";

export const updateChapterTitle = publicActionClient
  .metadata({ action: "update-chapter-title" })
  .inputSchema(updateChapterTitleActionSchema)
  .action(async ({ parsedInput }): Promise<StoryChapterItem> => {
    const now = day().toISOString();
    const db = getDb();
    const [chapter] = await db
      .update(chapters)
      .set({
        name: parsedInput.name,
        updatedAt: now,
      })
      .where(
        and(
          eq(chapters.id, parsedInput.chapterId),
          eq(chapters.storyId, parsedInput.storyId),
        ),
      )
      .returning(storyChapterSelectFields);

    if (!chapter) {
      throw new ActionError("BAD_REQUEST", "The chapter could not be found.");
    }

    await db
      .update(stories)
      .set({ updatedAt: now })
      .where(eq(stories.id, parsedInput.storyId));

    return chapter;
  });
