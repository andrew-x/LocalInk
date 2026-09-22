"use server";

import { and, eq } from "drizzle-orm";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters } from "@/lib/drizzle/schema";
import {
  generateStoryChapterSynopsis,
  isChapterSynopsisStale,
} from "@/lib/server/story-chapter-synopses";

import { refreshChapterSynopsisActionSchema } from "./_schemas";

/**
 * Brings a chapter's synopsis back in step with its text.
 *
 * Called fire-and-forget after a chapter save rather than during prose
 * generation, so drafting stays a single model call. Generation reads
 * whatever synopsis is stored and tolerates a stale one.
 */
export const refreshChapterSynopsis = publicActionClient
  .metadata({ action: "refresh-chapter-synopsis" })
  .inputSchema(refreshChapterSynopsisActionSchema)
  .action(async ({ parsedInput }): Promise<{ didRefresh: boolean }> => {
    const db = getDb();
    const [chapter] = await db
      .select({
        name: chapters.name,
        content: chapters.content,
        synopsisSourceHash: chapters.synopsisSourceHash,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.id, parsedInput.chapterId),
          eq(chapters.storyId, parsedInput.storyId),
        ),
      )
      .limit(1);

    if (!chapter) {
      throw new ActionError("BAD_REQUEST", "The chapter could not be found.");
    }

    if (!isChapterSynopsisStale(chapter.content, chapter.synopsisSourceHash)) {
      return { didRefresh: false };
    }

    const result = await generateStoryChapterSynopsis({
      content: chapter.content,
      name: chapter.name,
    });

    if (!result) {
      return { didRefresh: false };
    }

    // Written against the hash of the summarized text, so an edit that landed
    // while the request was in flight leaves the row stale and the next save
    // picks it up again.
    await db
      .update(chapters)
      .set({
        synopsis: result.synopsis,
        synopsisSourceHash: result.sourceHash,
        synopsisUpdatedAt: day().toISOString(),
      })
      .where(
        and(
          eq(chapters.id, parsedInput.chapterId),
          eq(chapters.storyId, parsedInput.storyId),
        ),
      );

    return { didRefresh: true };
  });
