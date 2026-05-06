import "server-only";

import { and, eq } from "drizzle-orm";

import type {
  ChapterIndexResult,
  ChapterIndexTriggerReason,
} from "@/actions/stories/_types";
import { embedLocalinkTexts, generateLocalinkText } from "@/lib/ai";
import {
  chunkMarkdownChapter,
  serializeFloat32Embedding,
} from "@/lib/chapter-indexing";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { chapters, chunks } from "@/lib/drizzle/schema";
import { createLogger } from "@/lib/logger";
import { generateId } from "@/lib/util";

import { hashChapterContent } from "./chapter-hash";

type IndexChapterInput = {
  chapterId: string;
  storyId: string;
  triggerReason: ChapterIndexTriggerReason;
};

type ChapterSnapshot = {
  content: string;
  indexedHash: string;
  name: string;
};

type PreparedChunk = {
  embedding: Buffer;
  endPosition: number;
  id: string;
  startPosition: number;
  text: string;
};

type ChapterIndexJobResolver = {
  reject: (error: unknown) => void;
  resolve: (result: ChapterIndexResult) => void;
};

type ChapterIndexJobState = {
  pendingInput: IndexChapterInput | null;
  pendingResolvers: ChapterIndexJobResolver[];
};

const chapterIndexLogger = createLogger("chapter-index");
const chapterIndexJobs = new Map<string, ChapterIndexJobState>();

export function indexChapterContent(
  input: IndexChapterInput,
): Promise<ChapterIndexResult> {
  const existingJobState = chapterIndexJobs.get(input.chapterId);

  if (existingJobState) {
    chapterIndexLogger.info("dedupe", {
      storyId: input.storyId,
      chapterId: input.chapterId,
      triggerReason: input.triggerReason,
    });

    existingJobState.pendingInput = input;

    return new Promise<ChapterIndexResult>((resolve, reject) => {
      existingJobState.pendingResolvers.push({ resolve, reject });
    });
  }

  const jobState: ChapterIndexJobState = {
    pendingInput: null,
    pendingResolvers: [],
  };
  const job = runChapterIndexQueue(input, jobState).finally(() => {
    if (chapterIndexJobs.get(input.chapterId) === jobState) {
      chapterIndexJobs.delete(input.chapterId);
    }
  });

  chapterIndexJobs.set(input.chapterId, jobState);

  return job;
}

async function runChapterIndexQueue(
  initialInput: IndexChapterInput,
  jobState: ChapterIndexJobState,
): Promise<ChapterIndexResult> {
  let input: IndexChapterInput | null = initialInput;
  let result: ChapterIndexResult | null = null;

  try {
    while (input) {
      const currentInput = input;

      jobState.pendingInput = null;
      result = await runChapterIndex(currentInput);
      input = jobState.pendingInput;
    }

    if (!result) {
      throw new Error("Chapter index queue completed without a result.");
    }

    for (const resolver of jobState.pendingResolvers) {
      resolver.resolve(result);
    }

    return result;
  } catch (error) {
    for (const resolver of jobState.pendingResolvers) {
      resolver.reject(error);
    }

    throw error;
  }
}

async function runChapterIndex(
  input: IndexChapterInput,
): Promise<ChapterIndexResult> {
  const snapshot = await loadChapterSnapshot(input);

  if (!snapshot) {
    return buildResult(input, "not-found", {
      chunkCount: 0,
      indexedAt: null,
      indexedHash: null,
    });
  }

  const contentHash = hashChapterContent(snapshot.content);

  if (contentHash === snapshot.indexedHash) {
    chapterIndexLogger.info("skip-current", {
      storyId: input.storyId,
      chapterId: input.chapterId,
      triggerReason: input.triggerReason,
    });

    return buildResult(input, "skipped-current", {
      chunkCount: 0,
      indexedAt: null,
      indexedHash: contentHash,
    });
  }

  if (snapshot.content.trim().length === 0) {
    return commitEmptyChapterIndex(input, contentHash);
  }

  const chapterChunks = chunkMarkdownChapter(snapshot.content);
  const summary = await summarizeChapter(snapshot);
  const embeddings = await embedLocalinkTexts(
    chapterChunks.map((chapterChunk) => chapterChunk.text),
  );

  if (embeddings.length !== chapterChunks.length) {
    throw new Error("Embedding count did not match chapter chunk count.");
  }

  const preparedChunks = chapterChunks.map((chapterChunk, index) => ({
    id: generateId("chunk"),
    text: chapterChunk.text,
    startPosition: chapterChunk.startPosition,
    endPosition: chapterChunk.endPosition,
    embedding: serializeFloat32Embedding(embeddings[index]),
  }));

  return commitChapterIndex(input, {
    chunks: preparedChunks,
    contentHash,
    summary,
  });
}

async function loadChapterSnapshot({
  chapterId,
  storyId,
}: IndexChapterInput): Promise<ChapterSnapshot | null> {
  const db = getDb();
  const [chapter] = await db
    .select({
      name: chapters.name,
      content: chapters.content,
      indexedHash: chapters.indexedHash,
    })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.storyId, storyId)))
    .limit(1);

  return chapter ?? null;
}

async function summarizeChapter(chapter: ChapterSnapshot): Promise<string> {
  const summary = await generateLocalinkText({
    model: "fast",
    system: [
      "You are LocalInk's private chapter indexing engine.",
      "Summarize fiction manuscript text for future writing context.",
      "Return only a complete synopsis of the chapter. Do not include labels, markdown fences, or analysis.",
    ].join(" "),
    prompt: [
      `Chapter title: ${chapter.name}`,
      "",
      "Chapter content:",
      chapter.content,
    ].join("\n"),
  });

  return summary.trim();
}

function commitEmptyChapterIndex(
  input: IndexChapterInput,
  contentHash: string,
): ChapterIndexResult {
  const indexedAt = day().toISOString();
  const db = getDb();
  const status = db.transaction((tx) => {
    const currentChapter = tx
      .select({ content: chapters.content })
      .from(chapters)
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.storyId, input.storyId),
        ),
      )
      .get();

    if (!currentChapter) {
      return "not-found" as const;
    }

    if (hashChapterContent(currentChapter.content) !== contentHash) {
      return "discarded-changed" as const;
    }

    tx.delete(chunks).where(eq(chunks.chapterId, input.chapterId)).run();
    tx.update(chapters)
      .set({
        summary: "",
        indexedHash: contentHash,
        indexedAt,
      })
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.storyId, input.storyId),
        ),
      )
      .run();

    return "cleared-empty" as const;
  });

  logCommitResult(input, status, 0);

  return buildResult(input, status, {
    chunkCount: 0,
    indexedAt: status === "cleared-empty" ? indexedAt : null,
    indexedHash: status === "cleared-empty" ? contentHash : null,
  });
}

function commitChapterIndex(
  input: IndexChapterInput,
  preparedIndex: {
    chunks: PreparedChunk[];
    contentHash: string;
    summary: string;
  },
): ChapterIndexResult {
  const indexedAt = day().toISOString();
  const db = getDb();
  const status = db.transaction((tx) => {
    const currentChapter = tx
      .select({ content: chapters.content })
      .from(chapters)
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.storyId, input.storyId),
        ),
      )
      .get();

    if (!currentChapter) {
      return "not-found" as const;
    }

    if (
      hashChapterContent(currentChapter.content) !== preparedIndex.contentHash
    ) {
      return "discarded-changed" as const;
    }

    tx.delete(chunks).where(eq(chunks.chapterId, input.chapterId)).run();

    if (preparedIndex.chunks.length > 0) {
      tx.insert(chunks)
        .values(
          preparedIndex.chunks.map((chapterChunk) => ({
            id: chapterChunk.id,
            storyId: input.storyId,
            chapterId: input.chapterId,
            text: chapterChunk.text,
            startPosition: chapterChunk.startPosition,
            endPosition: chapterChunk.endPosition,
            embedding: chapterChunk.embedding,
          })),
        )
        .run();
    }

    tx.update(chapters)
      .set({
        summary: preparedIndex.summary,
        indexedHash: preparedIndex.contentHash,
        indexedAt,
      })
      .where(
        and(
          eq(chapters.id, input.chapterId),
          eq(chapters.storyId, input.storyId),
        ),
      )
      .run();

    return "indexed" as const;
  });

  logCommitResult(input, status, preparedIndex.chunks.length);

  return buildResult(input, status, {
    chunkCount: status === "indexed" ? preparedIndex.chunks.length : 0,
    indexedAt: status === "indexed" ? indexedAt : null,
    indexedHash: status === "indexed" ? preparedIndex.contentHash : null,
  });
}

function logCommitResult(
  input: IndexChapterInput,
  status: ChapterIndexResult["status"],
  chunkCount: number,
) {
  chapterIndexLogger.info("complete", {
    storyId: input.storyId,
    chapterId: input.chapterId,
    triggerReason: input.triggerReason,
    status,
    chunkCount,
  });
}

function buildResult(
  input: IndexChapterInput,
  status: ChapterIndexResult["status"],
  details: Pick<ChapterIndexResult, "chunkCount" | "indexedAt" | "indexedHash">,
): ChapterIndexResult {
  return {
    storyId: input.storyId,
    chapterId: input.chapterId,
    chapter: null,
    status,
    ...details,
  };
}
