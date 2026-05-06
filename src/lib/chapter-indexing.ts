export const CHAPTER_INDEX_TARGET_CHARS = 1_800;
export const CHAPTER_INDEX_OVERLAP_CHARS = 600;

export type ChapterIndexChunk = {
  endPosition: number;
  startPosition: number;
  text: string;
};

type ChapterParagraph = {
  endPosition: number;
  startPosition: number;
};

export function chunkMarkdownChapter(
  content: string,
  options: {
    overlapChars?: number;
    targetChars?: number;
  } = {},
): ChapterIndexChunk[] {
  const targetChars = options.targetChars ?? CHAPTER_INDEX_TARGET_CHARS;
  const overlapChars = options.overlapChars ?? CHAPTER_INDEX_OVERLAP_CHARS;
  const paragraphs = getMarkdownParagraphs(content);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: ChapterIndexChunk[] = [];
  let currentParagraphs: ChapterParagraph[] = [];
  let newParagraphCount = 0;

  for (const paragraph of paragraphs) {
    if (
      currentParagraphs.length > 0 &&
      newParagraphCount > 0 &&
      getParagraphRangeLength([...currentParagraphs, paragraph]) > targetChars
    ) {
      chunks.push(createChunk(content, currentParagraphs));
      currentParagraphs = getOverlapParagraphs(currentParagraphs, overlapChars);
      newParagraphCount = 0;
    }

    currentParagraphs.push(paragraph);
    newParagraphCount += 1;
  }

  if (newParagraphCount > 0) {
    chunks.push(createChunk(content, currentParagraphs));
  }

  return chunks;
}

export function serializeFloat32Embedding(embedding: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT,
  );

  embedding.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding values must be finite numbers.");
    }

    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });

  return buffer;
}

function getMarkdownParagraphs(content: string): ChapterParagraph[] {
  const paragraphs: ChapterParagraph[] = [];
  let paragraphStart: number | null = null;
  let paragraphEnd = 0;
  let cursor = 0;

  while (cursor < content.length) {
    const lineStart = cursor;
    const nextLineBreak = findNextLineBreak(content, cursor);
    const lineEnd =
      nextLineBreak === -1
        ? content.length
        : getLineContentEnd(content, nextLineBreak);
    const nextLineStart =
      nextLineBreak === -1
        ? content.length
        : nextLineBreak + getLineBreakLength(content, nextLineBreak);
    const line = content.slice(lineStart, lineEnd);

    if (line.trim().length === 0) {
      if (paragraphStart !== null) {
        paragraphs.push({
          startPosition: paragraphStart,
          endPosition: paragraphEnd,
        });
        paragraphStart = null;
      }
    } else {
      paragraphStart ??= lineStart;
      paragraphEnd = lineEnd;
    }

    cursor = nextLineStart;
  }

  if (paragraphStart !== null) {
    paragraphs.push({
      startPosition: paragraphStart,
      endPosition: paragraphEnd,
    });
  }

  return paragraphs;
}

function findNextLineBreak(content: string, startPosition: number): number {
  const lineFeedIndex = content.indexOf("\n", startPosition);
  const carriageReturnIndex = content.indexOf("\r", startPosition);

  if (lineFeedIndex === -1) {
    return carriageReturnIndex;
  }

  if (carriageReturnIndex === -1) {
    return lineFeedIndex;
  }

  return Math.min(lineFeedIndex, carriageReturnIndex);
}

function getLineContentEnd(content: string, lineBreakIndex: number): number {
  if (content[lineBreakIndex] !== "\n") {
    return lineBreakIndex;
  }

  return lineBreakIndex > 0 && content[lineBreakIndex - 1] === "\r"
    ? lineBreakIndex - 1
    : lineBreakIndex;
}

function getLineBreakLength(content: string, lineBreakIndex: number): number {
  return content[lineBreakIndex] === "\r" &&
    content[lineBreakIndex + 1] === "\n"
    ? 2
    : 1;
}

function getParagraphRangeLength(paragraphs: ChapterParagraph[]): number {
  const firstParagraph = paragraphs[0];
  const lastParagraph = paragraphs.at(-1);

  if (!firstParagraph || !lastParagraph) {
    return 0;
  }

  return lastParagraph.endPosition - firstParagraph.startPosition;
}

function getOverlapParagraphs(
  paragraphs: ChapterParagraph[],
  overlapChars: number,
): ChapterParagraph[] {
  const overlapParagraphs: ChapterParagraph[] = [];

  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    overlapParagraphs.unshift(paragraphs[index]);

    if (getParagraphRangeLength(overlapParagraphs) >= overlapChars) {
      break;
    }
  }

  return overlapParagraphs;
}

function createChunk(
  content: string,
  paragraphs: ChapterParagraph[],
): ChapterIndexChunk {
  const firstParagraph = paragraphs[0];
  const lastParagraph = paragraphs.at(-1);

  if (!firstParagraph || !lastParagraph) {
    throw new Error("Cannot create a chapter chunk without paragraphs.");
  }

  return {
    startPosition: firstParagraph.startPosition,
    endPosition: lastParagraph.endPosition,
    text: content.slice(
      firstParagraph.startPosition,
      lastParagraph.endPosition,
    ),
  };
}
