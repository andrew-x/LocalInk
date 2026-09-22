import "server-only";

import { createHash } from "node:crypto";

import { generateLocalinkText } from "@/lib/ai";

/**
 * Chapter text below this length is its own best summary — sending it to a
 * model would cost a request to produce something no shorter than the source.
 */
const MIN_SYNOPSIS_SOURCE_CHARS = 600;
const MAX_SYNOPSIS_SOURCE_CHARS = 60_000;
const MAX_SYNOPSIS_OUTPUT_TOKENS = 500;

/**
 * Low, but not zero. This is extraction, not invention: the same chapter
 * should summarize the same way each time, while leaving the model enough
 * room to phrase a messy draft sensibly.
 */
const SYNOPSIS_TEMPERATURE = 0.2;

const SYNOPSIS_SYSTEM_PROMPT = [
  "Summarize a fiction chapter as story state for a writing tool. You are not writing prose and not evaluating the chapter.",
  "",
  "Report only what the chapter establishes, in the order it happens. Cover: what happens; what changes as a result; what each character present learns, decides, or now believes; where and when the chapter leaves off; and what it leaves unresolved.",
  "",
  "Rules:",
  "Be concrete and specific. Use character and place names, not roles.",
  "Record the chapter's end state, not just its events. When something established earlier is reversed, resolved, or made obsolete within the chapter, say so.",
  "Do not speculate about what happens next, interpret themes, praise, critique, or suggest changes.",
  "Do not quote the prose or imitate its voice.",
  "Return plain prose in short paragraphs. No headings, labels, bullets, or markdown.",
].join("\n");

export type StoryChapterSynopsisResult = {
  synopsis: string;
  sourceHash: string;
};

export function getChapterSynopsisSourceHash(content: string): string {
  return createHash("sha256").update(content.trim()).digest("hex");
}

/**
 * True when a chapter's stored synopsis no longer describes its content.
 *
 * Content-hash based rather than timestamp based, so a save that did not
 * change the text does not trigger a regeneration.
 */
export function isChapterSynopsisStale(
  content: string,
  synopsisSourceHash: string,
): boolean {
  return getChapterSynopsisSourceHash(content) !== synopsisSourceHash;
}

export function isChapterSynopsisWorthGenerating(content: string): boolean {
  return content.trim().length >= MIN_SYNOPSIS_SOURCE_CHARS;
}

/**
 * Generates a chapter synopsis with the fast model.
 *
 * Deliberately not part of the prose request: it runs in the background after
 * a chapter is saved, so drafting stays a single model call with no added
 * latency, and generation reads whatever synopsis is already stored.
 */
export async function generateStoryChapterSynopsis({
  abortSignal,
  content,
  name,
}: {
  abortSignal?: AbortSignal;
  content: string;
  name: string;
}): Promise<StoryChapterSynopsisResult | null> {
  const trimmedContent = content.trim();

  if (!isChapterSynopsisWorthGenerating(trimmedContent)) {
    return null;
  }

  const result = await generateLocalinkText({
    model: "fast",
    system: SYNOPSIS_SYSTEM_PROMPT,
    prompt: buildChapterSynopsisPrompt(name, trimmedContent),
    abortSignal,
    maxOutputTokens: MAX_SYNOPSIS_OUTPUT_TOKENS,
    temperature: SYNOPSIS_TEMPERATURE,
  });
  const synopsis = result.text.trim();

  if (!synopsis) {
    return null;
  }

  return {
    synopsis,
    // Hash the text that was actually summarized, so a chapter edited while
    // this request was in flight reads as stale rather than up to date.
    sourceHash: getChapterSynopsisSourceHash(trimmedContent),
  };
}

function buildChapterSynopsisPrompt(name: string, content: string): string {
  return [
    "<CHAPTER>",
    `<TITLE>\n${escapeXmlText(name)}\n</TITLE>`,
    `<CHAPTER_TEXT>\n${escapeXmlText(truncateChapterText(content))}\n</CHAPTER_TEXT>`,
    "</CHAPTER>",
  ].join("\n");
}

/**
 * Keeps the head and tail of an oversized chapter.
 *
 * The opening establishes the situation and the ending carries the state the
 * next chapter continues from, so both matter more than the middle when the
 * whole thing will not fit.
 */
function truncateChapterText(content: string): string {
  if (content.length <= MAX_SYNOPSIS_SOURCE_CHARS) {
    return content;
  }

  const headChars = Math.ceil(MAX_SYNOPSIS_SOURCE_CHARS * 0.6);
  const tailChars = Math.floor(MAX_SYNOPSIS_SOURCE_CHARS * 0.4);

  return [
    content.slice(0, headChars).trimEnd(),
    "",
    "[Middle omitted to fit the model context.]",
    "",
    content.slice(content.length - tailChars).trimStart(),
  ].join("\n");
}

function escapeXmlText(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
