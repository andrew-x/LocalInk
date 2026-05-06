export const STORY_PROSE_RETRIEVAL_MAX_CHUNKS = 10;
export const STORY_PROSE_RETRIEVAL_MIN_CHUNKS = 2;
export const STORY_PROSE_RETRIEVAL_MIN_SCORE_RATIO = 0.65;
export const STORY_PROSE_RETRIEVAL_RRF_K = 60;

type RetrievalDocument = {
  id: string;
  text: string;
};

type EmbeddedRetrievalDocument = {
  embedding: number[] | null | undefined;
  id: string;
};

export type RankedRetrievalResult = {
  id: string;
  score: number;
};

export function tokenizeRetrievalText(text: string): string[] {
  return (
    text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu) ?? []
  );
}

export function rankBm25(
  documents: RetrievalDocument[],
  query: string,
): RankedRetrievalResult[] {
  if (documents.length === 0) {
    return [];
  }

  const queryTerms = [...new Set(tokenizeRetrievalText(query))];

  if (queryTerms.length === 0) {
    return [];
  }

  const preparedDocuments = documents.map((document, index) => {
    const tokens = tokenizeRetrievalText(document.text);

    return {
      ...document,
      index,
      length: tokens.length,
      termCounts: countTerms(tokens),
    };
  });
  const totalTokenCount = preparedDocuments.reduce(
    (total, document) => total + document.length,
    0,
  );
  const averageDocumentLength = totalTokenCount / preparedDocuments.length;

  if (averageDocumentLength === 0) {
    return [];
  }

  const documentFrequencies = new Map<string, number>();

  for (const term of queryTerms) {
    documentFrequencies.set(
      term,
      preparedDocuments.filter((document) => document.termCounts.has(term))
        .length,
    );
  }

  const k1 = 1.5;
  const b = 0.75;

  return preparedDocuments
    .map((document) => {
      let score = 0;

      for (const term of queryTerms) {
        const termFrequency = document.termCounts.get(term) ?? 0;

        if (termFrequency === 0) {
          continue;
        }

        const documentFrequency = documentFrequencies.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 +
            (documents.length - documentFrequency + 0.5) /
              (documentFrequency + 0.5),
        );
        const denominator =
          termFrequency +
          k1 * (1 - b + b * (document.length / averageDocumentLength));

        score +=
          inverseDocumentFrequency * ((termFrequency * (k1 + 1)) / denominator);
      }

      return {
        id: document.id,
        index: document.index,
        score,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id, score }) => ({ id, score }));
}

export function rankVectorSimilarity(
  documents: EmbeddedRetrievalDocument[],
  queryEmbedding: number[],
): RankedRetrievalResult[] {
  return documents
    .map((document, index) => {
      if (!document.embedding) {
        return null;
      }

      const score = computeCosineSimilarity(queryEmbedding, document.embedding);

      if (score === null) {
        return null;
      }

      return {
        id: document.id,
        index,
        score,
      };
    })
    .filter((result): result is RankedRetrievalResult & { index: number } =>
      Boolean(result),
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id, score }) => ({ id, score }));
}

export function computeCosineSimilarity(
  left: number[],
  right: number[],
): number | null {
  if (left.length === 0 || left.length !== right.length) {
    return null;
  }

  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];

    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return null;
    }

    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function mergeRankingsWithRrf(
  rankings: RankedRetrievalResult[][],
  reciprocalRankK = STORY_PROSE_RETRIEVAL_RRF_K,
): RankedRetrievalResult[] {
  const merged = new Map<string, { firstSeen: number; score: number }>();
  let nextFirstSeen = 0;

  for (const ranking of rankings) {
    const seenInRanking = new Set<string>();

    ranking.forEach((result, index) => {
      if (seenInRanking.has(result.id)) {
        return;
      }

      seenInRanking.add(result.id);

      const contribution = 1 / (reciprocalRankK + index + 1);
      const existing = merged.get(result.id);

      if (existing) {
        existing.score += contribution;
        return;
      }

      merged.set(result.id, {
        firstSeen: nextFirstSeen,
        score: contribution,
      });
      nextFirstSeen += 1;
    });
  }

  return [...merged.entries()]
    .map(([id, result]) => ({
      id,
      firstSeen: result.firstSeen,
      score: result.score,
    }))
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map(({ id, score }) => ({ id, score }));
}

export function selectRetrievedResults<T extends RankedRetrievalResult>(
  results: T[],
  options: {
    maxResults?: number;
    minimumResults?: number;
    minScoreRatio?: number;
  } = {},
): T[] {
  const maxResults = options.maxResults ?? STORY_PROSE_RETRIEVAL_MAX_CHUNKS;
  const minimumResults =
    options.minimumResults ?? STORY_PROSE_RETRIEVAL_MIN_CHUNKS;
  const minScoreRatio =
    options.minScoreRatio ?? STORY_PROSE_RETRIEVAL_MIN_SCORE_RATIO;
  const sortedResults = results
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => b.score - a.score);
  const candidates = sortedResults.slice(0, maxResults);

  if (candidates.length === 0) {
    return [];
  }

  const requiredResultCount = Math.min(minimumResults, candidates.length);

  if (candidates.length <= requiredResultCount) {
    return candidates;
  }

  const topScore = candidates[0].score;
  const threshold = topScore * minScoreRatio;
  const thresholdCount = Math.max(
    1,
    candidates.filter((result) => result.score >= threshold).length,
  );
  const thresholdCandidates = candidates.slice(0, thresholdCount);
  const largestDropCount = getLargestScoreDropCutoffCount(thresholdCandidates);
  const limitedCount = Math.min(thresholdCount, largestDropCount, maxResults);
  const selectedCount = Math.min(
    maxResults,
    Math.max(requiredResultCount, limitedCount),
  );

  return candidates.slice(0, selectedCount);
}

export function isEligibleRetrievalChapterPosition(
  chapterPosition: number,
  focusedChapterPosition: number,
): boolean {
  return Math.abs(chapterPosition - focusedChapterPosition) > 1;
}

export function deserializeFloat32Embedding(
  embedding: ArrayBuffer | Buffer | Uint8Array | null | undefined,
): number[] | null {
  if (!embedding) {
    return null;
  }

  const buffer =
    embedding instanceof ArrayBuffer
      ? Buffer.from(embedding)
      : Buffer.from(
          embedding.buffer,
          embedding.byteOffset,
          embedding.byteLength,
        );

  if (buffer.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Float32 embedding buffer length must be divisible by 4.");
  }

  const values: number[] = [];

  for (
    let offset = 0;
    offset < buffer.length;
    offset += Float32Array.BYTES_PER_ELEMENT
  ) {
    values.push(buffer.readFloatLE(offset));
  }

  return values;
}

function countTerms(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return counts;
}

function getLargestScoreDropCutoffCount(
  results: RankedRetrievalResult[],
): number {
  if (results.length < 2) {
    return results.length;
  }

  let largestDrop = 0;
  let cutoffCount = results.length;

  for (let index = 0; index < results.length - 1; index += 1) {
    const drop = results[index].score - results[index + 1].score;

    if (drop > largestDrop) {
      largestDrop = drop;
      cutoffCount = index + 1;
    }
  }

  return largestDrop > 0 ? cutoffCount : results.length;
}
