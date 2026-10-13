import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, type LocalinkDb } from "@/lib/drizzle/db";
import { chapters } from "@/lib/drizzle/schema";
import type { StoryPromptContext } from "@/lib/story-prompt-suggestions-contract";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

import {
  getChapterSynopsisSourceHash,
  isChapterSynopsisWorthGenerating,
} from "./story-chapter-synopses";

export type PreparedStoryContext<
  T extends StoryPromptContext = StoryPromptContext,
> = T & {
  /** Server-verified provenance, never accepted from the browser. */
  synopsisProvenance: ReadonlyMap<string, string>;
};

export type PreparedStoryProseGenerationRequest =
  PreparedStoryContext<StoryProseGenerationRequest>;

/** Keep unsaved manuscript snapshots, but trust only matching server caches. */
export async function prepareStoryProseContext<T extends StoryPromptContext>(
  input: T,
  db: LocalinkDb = getDb(),
): Promise<PreparedStoryContext<T>> {
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
