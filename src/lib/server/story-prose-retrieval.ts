import "server-only";

import { and, asc, eq, gt, lt, or } from "drizzle-orm";

import { embedLocalinkTexts } from "@/lib/ai";
import { getDb } from "@/lib/drizzle/db";
import { chapters, chunks } from "@/lib/drizzle/schema";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";
import {
  deserializeFloat32Embedding,
  mergeRankingsWithRrf,
  rankBm25,
  rankVectorSimilarity,
  selectRetrievedResults,
} from "@/lib/story-prose-retrieval-ranking";

const RETRIEVAL_INSERTION_CONTEXT_CHARS = 4_000;

type EligibleStoryChunk = {
  chapterPosition: number;
  chapterTitle: string;
  embedding: Buffer | null;
  id: string;
  text: string;
};

type EmbeddedStoryChunk = {
  embedding: number[];
  id: string;
};

export type StoryProseRetrievedChunk = {
  chapterPosition: number;
  chapterTitle: string;
  text: string;
};

export type StoryProseRetrievalResult = {
  bm25RankedCount: number;
  chunks: StoryProseRetrievedChunk[];
  eligibleChunkCount: number;
  mergedRankedCount: number;
  vectorRankedCount: number;
};

export async function retrieveStoryProseContext(
  request: StoryProseGenerationRequest,
): Promise<StoryProseRetrievalResult> {
  const eligibleChunks = await loadEligibleStoryChunks({
    focusedChapterPosition: request.focusedChapter.position,
    storyId: request.story.id,
  });

  if (eligibleChunks.length === 0) {
    return emptyRetrievalResult();
  }

  const retrievalQuery = buildStoryProseRetrievalQuery(request);
  const queryEmbeddingPromise = hasEmbeddedChunks(eligibleChunks)
    ? embedStoryProseRetrievalQuery(retrievalQuery)
    : Promise.resolve(null);
  const [bm25Ranking, embeddedChunks, queryEmbedding] = await Promise.all([
    Promise.resolve().then(() =>
      rankBm25(
        eligibleChunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
        })),
        retrievalQuery,
      ),
    ),
    Promise.resolve().then(() => prepareEmbeddedChunks(eligibleChunks)),
    queryEmbeddingPromise,
  ]);
  const vectorRanking = queryEmbedding
    ? rankVectorSimilarity(embeddedChunks, queryEmbedding)
    : [];
  const mergedRanking = mergeRankingsWithRrf([bm25Ranking, vectorRanking]);
  const selectedResults = selectRetrievedResults(mergedRanking);
  const chunksById = new Map(
    eligibleChunks.map((chunk) => [chunk.id, chunk] as const),
  );

  return {
    bm25RankedCount: bm25Ranking.length,
    chunks: selectedResults.flatMap((result) => {
      const chunk = chunksById.get(result.id);

      if (!chunk) {
        return [];
      }

      return [
        {
          chapterPosition: chunk.chapterPosition,
          chapterTitle: chunk.chapterTitle,
          text: chunk.text,
        },
      ];
    }),
    eligibleChunkCount: eligibleChunks.length,
    mergedRankedCount: mergedRanking.length,
    vectorRankedCount: vectorRanking.length,
  };
}

async function loadEligibleStoryChunks({
  focusedChapterPosition,
  storyId,
}: {
  focusedChapterPosition: number;
  storyId: string;
}): Promise<EligibleStoryChunk[]> {
  const db = getDb();
  const rows = await db
    .select({
      chapterPosition: chapters.position,
      chapterTitle: chapters.name,
      embedding: chunks.embedding,
      id: chunks.id,
      text: chunks.text,
    })
    .from(chunks)
    .innerJoin(chapters, eq(chunks.chapterId, chapters.id))
    .where(
      and(
        eq(chunks.storyId, storyId),
        eq(chapters.storyId, storyId),
        or(
          lt(chapters.position, focusedChapterPosition - 1),
          gt(chapters.position, focusedChapterPosition + 1),
        ),
      ),
    )
    .orderBy(asc(chapters.position), asc(chunks.startPosition));

  return rows;
}

function hasEmbeddedChunks(eligibleChunks: EligibleStoryChunk[]): boolean {
  return eligibleChunks.some((chunk) => chunk.embedding !== null);
}

function prepareEmbeddedChunks(
  eligibleChunks: EligibleStoryChunk[],
): EmbeddedStoryChunk[] {
  return eligibleChunks.flatMap((chunk) => {
    const embedding = deserializeFloat32Embedding(chunk.embedding);

    if (!embedding) {
      return [];
    }

    return [
      {
        embedding,
        id: chunk.id,
      },
    ];
  });
}

async function embedStoryProseRetrievalQuery(
  retrievalQuery: string,
): Promise<number[]> {
  const [queryEmbedding] = await embedLocalinkTexts([retrievalQuery]);

  if (!queryEmbedding) {
    throw new Error("Embedding query did not return an embedding.");
  }

  return queryEmbedding;
}

function buildStoryProseRetrievalQuery(
  request: StoryProseGenerationRequest,
): string {
  return [
    "User instructions:",
    buildStoryProseRetrievalInstructions(request),
    "",
    "Focused chapter title:",
    request.focusedChapter.name,
    "",
    "Focused chapter summary:",
    request.focusedChapter.summary.trim() || "No summary provided.",
    "",
    "Text before insertion:",
    getTrailingText(
      request.insertion.beforeText,
      RETRIEVAL_INSERTION_CONTEXT_CHARS,
    ) || "No text before the insertion point.",
    "",
    "Text after insertion:",
    getLeadingText(
      request.insertion.afterText,
      RETRIEVAL_INSERTION_CONTEXT_CHARS,
    ) || "No text after the insertion point.",
  ].join("\n");
}

function buildStoryProseRetrievalInstructions(
  request: StoryProseGenerationRequest,
): string {
  const instructions =
    request.instructions.trim() || "Continue the story naturally.";
  const regeneration = request.regeneration;

  if (regeneration?.mode === "fresh-alternative") {
    return `${instructions}\nRegenerate as a fresh alternative draft.`;
  }

  if (regeneration?.mode === "revise-prior-draft") {
    return `${instructions}\nRegeneration edit instructions: ${regeneration.editInstructions.trim()}`;
  }

  return instructions;
}

function getLeadingText(text: string, maxChars: number): string {
  return text.trim().slice(0, maxChars).trim();
}

function getTrailingText(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  return trimmedText.slice(Math.max(0, trimmedText.length - maxChars)).trim();
}

function emptyRetrievalResult(): StoryProseRetrievalResult {
  return {
    bm25RankedCount: 0,
    chunks: [],
    eligibleChunkCount: 0,
    mergedRankedCount: 0,
    vectorRankedCount: 0,
  };
}
