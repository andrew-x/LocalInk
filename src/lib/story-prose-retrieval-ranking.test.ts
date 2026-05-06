// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import {
  deserializeFloat32Embedding,
  isEligibleRetrievalChapterPosition,
  mergeRankingsWithRrf,
  rankBm25,
  rankVectorSimilarity,
  selectRetrievedResults,
  tokenizeRetrievalText,
} from "./story-prose-retrieval-ranking";

describe("story prose retrieval ranking", () => {
  test("tokenizes prose and ranks BM25 matches", () => {
    expect(tokenizeRetrievalText("Dragon's fire, DRAGON fire!")).toEqual([
      "dragon's",
      "fire",
      "dragon",
      "fire",
    ]);

    const ranking = rankBm25(
      [
        {
          id: "storm",
          text: "A hidden dragon breathes blue fire beneath the tower.",
        },
        {
          id: "market",
          text: "The baker opens the quiet market at dawn.",
        },
        {
          id: "forest",
          text: "A dragon watches the forest.",
        },
      ],
      "dragon fire tower",
    );

    expect(ranking.map((result) => result.id)).toEqual(["storm", "forest"]);
    expect(ranking[0].score).toBeGreaterThan(ranking[1].score);
  });

  test("orders vector similarity and skips chunks without usable embeddings", () => {
    const ranking = rankVectorSimilarity(
      [
        { id: "north", embedding: [0, 1] },
        { id: "east", embedding: [1, 0] },
        { id: "diagonal", embedding: [0.5, 0.5] },
        { id: "missing", embedding: null },
        { id: "wrong-dimensions", embedding: [1, 0, 0] },
      ],
      [1, 0],
    );

    expect(ranking.map((result) => result.id)).toEqual([
      "east",
      "diagonal",
      "north",
    ]);
  });

  test("merges rankings with reciprocal rank fusion and dedupes within each ranking", () => {
    const ranking = mergeRankingsWithRrf(
      [
        [
          { id: "a", score: 20 },
          { id: "b", score: 10 },
          { id: "a", score: 5 },
        ],
        [
          { id: "b", score: 30 },
          { id: "c", score: 20 },
        ],
      ],
      60,
    );

    expect(ranking.map((result) => result.id)).toEqual(["b", "a", "c"]);
    expect(ranking[0].score).toBeGreaterThan(ranking[1].score);
  });

  test("selects results with the score ratio cutoff", () => {
    const selected = selectRetrievedResults([
      { id: "a", score: 1 },
      { id: "b", score: 0.7 },
      { id: "c", score: 0.64 },
      { id: "d", score: 0.63 },
    ]);

    expect(selected.map((result) => result.id)).toEqual(["a", "b"]);
  });

  test("selects results before the largest adjacent score drop", () => {
    const selected = selectRetrievedResults(
      [
        { id: "a", score: 1 },
        { id: "b", score: 0.96 },
        { id: "c", score: 0.5 },
        { id: "d", score: 0.49 },
      ],
      { minScoreRatio: 0.4 },
    );

    expect(selected.map((result) => result.id)).toEqual(["a", "b"]);
  });

  test("caps selection at ten results", () => {
    const selected = selectRetrievedResults(
      Array.from({ length: 12 }, (_, index) => ({
        id: `chunk-${index}`,
        score: 1,
      })),
    );

    expect(selected).toHaveLength(10);
    expect(selected.map((result) => result.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `chunk-${index}`),
    );
  });

  test("keeps at least two available results when possible", () => {
    const selected = selectRetrievedResults([
      { id: "a", score: 1 },
      { id: "b", score: 0.2 },
      { id: "c", score: 0.19 },
    ]);

    expect(selected.map((result) => result.id)).toEqual(["a", "b"]);
  });

  test("handles empty corpora and adjacent chapter exclusion", () => {
    expect(rankBm25([], "dragon")).toEqual([]);
    expect(selectRetrievedResults([])).toEqual([]);
    expect(isEligibleRetrievalChapterPosition(3, 5)).toBe(true);
    expect(isEligibleRetrievalChapterPosition(4, 5)).toBe(false);
    expect(isEligibleRetrievalChapterPosition(5, 5)).toBe(false);
    expect(isEligibleRetrievalChapterPosition(6, 5)).toBe(false);
    expect(isEligibleRetrievalChapterPosition(7, 5)).toBe(true);
  });

  test("decodes stored float32 embeddings", () => {
    const buffer = Buffer.allocUnsafe(2 * Float32Array.BYTES_PER_ELEMENT);

    buffer.writeFloatLE(0.25, 0);
    buffer.writeFloatLE(-0.5, Float32Array.BYTES_PER_ELEMENT);

    expect(deserializeFloat32Embedding(buffer)).toEqual([0.25, -0.5]);
  });
});
