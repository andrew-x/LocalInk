"use server";

import { and, eq } from "drizzle-orm";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters, stories } from "@/lib/drizzle/schema";
import { storyChapterSelectFields } from "@/lib/server/story-chapters";

import { updateChapterContentActionSchema } from "./_schemas";
import type { StoryChapterItem } from "./_types";

export const updateChapterContent = publicActionClient
  .metadata({ action: "update-chapter-content" })
  .inputSchema(updateChapterContentActionSchema)
  .action(async ({ parsedInput }): Promise<StoryChapterItem> => {
    const now = day().toISOString();
    const db = getDb();
    return db.transaction((tx) => {
      const current = tx
        .select(storyChapterSelectFields)
        .from(chapters)
        .where(
          and(
            eq(chapters.id, parsedInput.chapterId),
            eq(chapters.storyId, parsedInput.storyId),
          ),
        )
        .get();
      if (!current) {
        throw new ActionError("BAD_REQUEST", "The chapter could not be found.");
      }
      // A response may be lost after commit. A retry of that exact body is safe.
      if (current.content === parsedInput.content) return current;
      if (current.contentRevision !== parsedInput.expectedContentRevision) {
        throw new ActionError(
          "CONFLICT",
          "This chapter changed elsewhere. Your writing has been preserved locally; reload the saved chapter before trying again.",
        );
      }
      const chapter = tx
        .update(chapters)
        .set({
          content: parsedInput.content,
          contentRevision: current.contentRevision + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(chapters.id, parsedInput.chapterId),
            eq(chapters.storyId, parsedInput.storyId),
            eq(chapters.contentRevision, parsedInput.expectedContentRevision),
          ),
        )
        .returning(storyChapterSelectFields)
        .get();
      if (!chapter) {
        throw new ActionError(
          "CONFLICT",
          "This chapter changed elsewhere. Your writing has been preserved locally.",
        );
      }
      tx.update(stories)
        .set({ updatedAt: now })
        .where(eq(stories.id, parsedInput.storyId))
        .run();
      return chapter;
    });
  });
