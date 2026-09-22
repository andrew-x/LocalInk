import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, type LocalinkDb } from "@/lib/drizzle/db";
import { chapters } from "@/lib/drizzle/schema";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

import {
  getChapterSynopsisSourceHash,
  isChapterSynopsisWorthGenerating,
} from "./story-chapter-synopses";

export type PreparedStoryProseGenerationRequest =
  StoryProseGenerationRequest & {
    /** Server-verified provenance, never accepted from the browser. */
    synopsisProvenance: ReadonlyMap<string, string>;
  };

/** Keep unsaved manuscript snapshots, but trust only matching server caches. */
export async function prepareStoryProseContext(
  input: StoryProseGenerationRequest,
  db: LocalinkDb = getDb(),
): Promise<PreparedStoryProseGenerationRequest> {
  const snapshots = new Map(
    input.chapters.map((chapter) => [chapter.id, chapter]),
  );
  snapshots.set(input.focusedChapter.id, input.focusedChapter);

  const storedChapters = await db
    .select({
      id: chapters.id,
      synopsis: chapters.synopsis,
      sourceHash: chapters.synopsisSourceHash,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.storyId, input.story.id),
        inArray(chapters.id, [...snapshots.keys()]),
      ),
    );
  const storedById = new Map(
    storedChapters.map((chapter) => [chapter.id, chapter]),
  );
  const synopsisProvenance = new Map<string, string>();
  const preparedChapters = [...snapshots.values()].map((chapter) => {
    const stored = storedById.get(chapter.id);
    const sourceHash = getChapterSynopsisSourceHash(chapter.content);
    const synopsis =
      isChapterSynopsisWorthGenerating(chapter.content) &&
      stored?.sourceHash === sourceHash
        ? stored.synopsis.trim()
        : "";
    if (synopsis) {
      synopsisProvenance.set(chapter.id, sourceHash);
    }
    return { ...chapter, synopsis };
  });

  return {
    ...input,
    chapters: preparedChapters,
    focusedChapter: preparedChapters.find(
      (chapter) => chapter.id === input.focusedChapter.id,
    ) ?? { ...input.focusedChapter, synopsis: "" },
    synopsisProvenance,
  };
}
