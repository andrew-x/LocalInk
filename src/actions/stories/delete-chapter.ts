"use server";

import { and, eq, gt, sql } from "drizzle-orm";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters, stories } from "@/lib/drizzle/schema";

import { deleteChapterActionSchema } from "./_schemas";

type DeletedChapter = {
  id: string;
  storyId: string;
  updatedAt: string;
};

export const deleteChapter = publicActionClient
  .metadata({ action: "delete-chapter" })
  .inputSchema(deleteChapterActionSchema)
  .action(async ({ parsedInput }): Promise<DeletedChapter> => {
    const now = day().toISOString();
    const db = getDb();
    const deletedChapter = db.transaction((tx) => {
      const chapter = tx
        .delete(chapters)
        .where(
          and(
            eq(chapters.id, parsedInput.chapterId),
            eq(chapters.storyId, parsedInput.storyId),
          ),
        )
        .returning({
          id: chapters.id,
          position: chapters.position,
        })
        .get();

      if (!chapter) {
        return null;
      }

      tx.update(chapters)
        .set({
          position: sql`${chapters.position} - 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(chapters.storyId, parsedInput.storyId),
            gt(chapters.position, chapter.position),
          ),
        )
        .run();

      tx.update(stories)
        .set({ updatedAt: now })
        .where(eq(stories.id, parsedInput.storyId))
        .run();

      return chapter;
    });

    if (!deletedChapter) {
      throw new ActionError("BAD_REQUEST", "The chapter could not be found.");
    }

    return {
      id: deletedChapter.id,
      storyId: parsedInput.storyId,
      updatedAt: now,
    };
  });
