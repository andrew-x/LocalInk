import "server-only";

import type { StoryProseRetrievedChunk } from "@/lib/server/story-prose-retrieval";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

const MAX_SECTION_CHARS = 24_000;
const MAX_FOCUSED_SECTION_CHARS = 36_000;
const MAX_RETRIEVED_CHUNK_CHARS = 2_400;
const OMITTED_CONTEXT_MARKER =
  "[Earlier and later context preserved; middle omitted to fit the model context.]";

export function buildStoryProsePrompt(
  request: StoryProseGenerationRequest,
  options: {
    retrievedChunks?: StoryProseRetrievedChunk[];
  } = {},
): string {
  const sections = [
    proseSection("Task", buildTaskSection(request)),
    proseSection("Story", buildStorySection(request)),
    proseSection("Style", request.style.trim() || "No style guide provided."),
    proseSection("Characters", buildCharactersSection(request)),
    options.retrievedChunks?.length
      ? proseSection(
          "Retrieved Story Context",
          buildRetrievedStoryContextSection(options.retrievedChunks),
        )
      : null,
    request.previousChapter
      ? proseSection(
          "Previous Chapter",
          buildChapterSection(request.previousChapter),
        )
      : null,
    proseSection("Focused Chapter", buildFocusedChapterSection(request)),
    request.nextChapter
      ? proseSection("Next Chapter", buildChapterSection(request.nextChapter))
      : null,
    proseSection(
      "User Instructions",
      request.instructions.trim() || "Continue the story naturally.",
    ),
    proseSection(
      "Length Target",
      `Aim for about ${request.approximateLength} words. This is guidance, not a hard limit.`,
    ),
  ].filter(Boolean);

  return [
    "You are LocalInk's fiction prose generation engine.",
    "Use the provided private story context only to write the requested continuation.",
    "Return prose only. Do not include explanations, labels, headings, analysis, or markdown fences.",
    "Use Markdown emphasis when it belongs in the story text: *italic*, **bold**, or ***bold italic***. Do not use HTML tags.",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

function buildTaskSection(request: StoryProseGenerationRequest): string {
  return [
    `Write about ${request.approximateLength} words of new prose that belongs at the insertion point in the focused chapter.`,
    request.insertion.atChapterEnd
      ? "The insertion point is at the end of the focused chapter."
      : "The insertion point is inside the focused chapter. Continue smoothly from the before-text and lead naturally into the after-text.",
    "Do not rewrite existing context unless the user specifically asks for it.",
    `Stay close to the requested ${request.approximateLength}-word length while prioritizing a natural scene break.`,
  ].join("\n");
}

function buildStorySection(request: StoryProseGenerationRequest): string {
  return [
    `Name: ${request.story.name}`,
    `Description: ${request.story.description.trim() || "No description provided."}`,
  ].join("\n");
}

function buildCharactersSection(request: StoryProseGenerationRequest): string {
  if (!request.characters.length) {
    return "No character notes provided.";
  }

  return request.characters
    .map((character) => {
      const description = character.description.trim();

      return `- ${character.name}: ${description || "No description provided."}`;
    })
    .join("\n");
}

function buildRetrievedStoryContextSection(
  retrievedChunks: StoryProseRetrievedChunk[],
): string {
  return retrievedChunks
    .map((chunk) =>
      [
        `Chapter ${chunk.chapterPosition}: ${chunk.chapterTitle}`,
        "",
        trimPromptSection(chunk.text, MAX_RETRIEVED_CHUNK_CHARS) ||
          "No excerpt text provided.",
      ].join("\n"),
    )
    .join("\n\n");
}

function buildFocusedChapterSection(
  request: StoryProseGenerationRequest,
): string {
  const beforeText = trimPromptSection(
    request.insertion.beforeText,
    MAX_FOCUSED_SECTION_CHARS,
  );
  const afterText = request.insertion.afterText.trim()
    ? trimPromptSection(request.insertion.afterText, MAX_FOCUSED_SECTION_CHARS)
    : "No text after the insertion point.";

  return [
    buildChapterMetadata(request.focusedChapter),
    "",
    "Full current chapter content:",
    trimPromptSection(
      request.focusedChapter.content,
      MAX_FOCUSED_SECTION_CHARS,
    ),
    "",
    "Text before insertion point:",
    beforeText || "No text before the insertion point.",
    "",
    "Text after insertion point:",
    afterText,
  ].join("\n");
}

function buildChapterSection(
  chapter: StoryProseGenerationRequest["focusedChapter"],
): string {
  return [
    buildChapterMetadata(chapter),
    "",
    trimPromptSection(chapter.content, MAX_SECTION_CHARS) ||
      "No chapter content provided.",
  ].join("\n");
}

function buildChapterMetadata(
  chapter: StoryProseGenerationRequest["focusedChapter"],
): string {
  return [
    `Title: ${chapter.name}`,
    `Position: ${chapter.position}`,
    `Summary: ${chapter.summary.trim() || "No summary provided."}`,
  ].join("\n");
}

function proseSection(title: string, content: string): string {
  const tag = title.toUpperCase().replace(/\s+/g, "_");

  return `<${tag}>\n${content}\n</${tag}>`;
}

function trimPromptSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text.trim();
  }

  const retainedChars = Math.max(0, maxChars - OMITTED_CONTEXT_MARKER.length);
  const headChars = Math.ceil(retainedChars * 0.6);
  const tailChars = Math.floor(retainedChars * 0.4);

  return [
    text.slice(0, headChars).trimEnd(),
    "",
    OMITTED_CONTEXT_MARKER,
    "",
    text.slice(text.length - tailChars).trimStart(),
  ].join("\n");
}
