import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type {
  StoryChapterChunkItem,
  StoryChapterIndexSnapshot,
  StoryChapterItem,
} from "@/actions/stories/_types";
import type { LocalinkDb } from "@/lib/drizzle/db";
import { chapters, chunks } from "@/lib/drizzle/schema";

type StoryChapterRow = Omit<StoryChapterItem, "chunks">;

export const storyChapterSelectFields = {
  id: chapters.id,
  name: chapters.name,
  position: chapters.position,
  content: chapters.content,
  indexedHash: chapters.indexedHash,
  indexedAt: chapters.indexedAt,
  summary: chapters.summary,
  updatedAt: chapters.updatedAt,
};

export async function attachChunksToChapters(
  db: LocalinkDb,
  storyId: string,
  storyChapters: StoryChapterRow[],
): Promise<StoryChapterItem[]> {
  const chunksByChapter = await loadStoryChunksByChapter(db, storyId);

  return storyChapters.map((chapter) => ({
    ...chapter,
    chunks: chunksByChapter.get(chapter.id) ?? [],
  }));
}

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

  if (!chapter) {
    return null;
  }

  return {
    ...chapter,
    chunks: await loadStoryChapterChunks(db, storyId, chapterId),
  };
}

export async function loadStoryChapterIndexSnapshotById(
  db: LocalinkDb,
  storyId: string,
  chapterId: string,
): Promise<StoryChapterIndexSnapshot | null> {
  const [chapter] = await db
    .select({
      id: chapters.id,
      indexedHash: chapters.indexedHash,
      indexedAt: chapters.indexedAt,
      summary: chapters.summary,
      updatedAt: chapters.updatedAt,
    })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.storyId, storyId)))
    .limit(1);

  if (!chapter) {
    return null;
  }

  return {
    ...chapter,
    chunks: await loadStoryChapterChunks(db, storyId, chapterId),
  };
}

async function loadStoryChapterChunks(
  db: LocalinkDb,
  storyId: string,
  chapterId: string,
): Promise<StoryChapterChunkItem[]> {
  return db
    .select({
      id: chunks.id,
      text: chunks.text,
      startPosition: chunks.startPosition,
      endPosition: chunks.endPosition,
    })
    .from(chunks)
    .where(and(eq(chunks.chapterId, chapterId), eq(chunks.storyId, storyId)))
    .orderBy(asc(chunks.startPosition));
}

async function loadStoryChunksByChapter(
  db: LocalinkDb,
  storyId: string,
): Promise<Map<string, StoryChapterChunkItem[]>> {
  const storyChunks = await db
    .select({
      id: chunks.id,
      chapterId: chunks.chapterId,
      text: chunks.text,
      startPosition: chunks.startPosition,
      endPosition: chunks.endPosition,
    })
    .from(chunks)
    .where(eq(chunks.storyId, storyId))
    .orderBy(asc(chunks.chapterId), asc(chunks.startPosition));

  const chunksByChapter = new Map<string, StoryChapterChunkItem[]>();

  for (const { chapterId, ...chapterChunk } of storyChunks) {
    const chapterChunks = chunksByChapter.get(chapterId) ?? [];

    chapterChunks.push(chapterChunk);
    chunksByChapter.set(chapterId, chapterChunks);
  }

  return chunksByChapter;
}
