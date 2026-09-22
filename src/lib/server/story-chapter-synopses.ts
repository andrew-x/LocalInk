import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { generateLocalinkText } from "@/lib/ai";
import day from "@/lib/dayjs";
import { getDb, type LocalinkDb } from "@/lib/drizzle/db";
import { chapters } from "@/lib/drizzle/schema";

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
  // Legacy caches did not verify completion and may describe truncated sources.
  // Version the hash so they expire without a schema migration or live backfill.
  return createHash("sha256")
    .update("chapter-synopsis-v2\0")
    .update(content.trim())
    .digest("hex");
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
  const length = content.trim().length;
  return (
    length >= MIN_SYNOPSIS_SOURCE_CHARS && length <= MAX_SYNOPSIS_SOURCE_CHARS
  );
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
  generateText = generateLocalinkText,
}: {
  abortSignal?: AbortSignal;
  content: string;
  name: string;
  generateText?: (
    options: Parameters<typeof generateLocalinkText>[0],
  ) => Promise<{ text: string; finishReason: string }>;
}): Promise<StoryChapterSynopsisResult | null> {
  const trimmedContent = content.trim();

  if (!isChapterSynopsisWorthGenerating(trimmedContent)) {
    return null;
  }

  const result = await generateText({
    model: "fast",
    system: SYNOPSIS_SYSTEM_PROMPT,
    prompt: buildChapterSynopsisPrompt(name, trimmedContent),
    abortSignal,
    maxOutputTokens: MAX_SYNOPSIS_OUTPUT_TOKENS,
    temperature: SYNOPSIS_TEMPERATURE,
  });
  const synopsis = result.text.trim();

  if (!synopsis || result.finishReason !== "stop") {
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
    `<CHAPTER_TEXT>\n${escapeXmlText(content)}\n</CHAPTER_TEXT>`,
    "</CHAPTER>",
  ].join("\n");
}

function escapeXmlText(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Refresh only the source snapshot read here; a late generation cannot win. */
export async function refreshStoryChapterSynopsis(
  input: { chapterId: string; storyId: string },
  dependencies: {
    db?: LocalinkDb;
    generate?: typeof generateStoryChapterSynopsis;
  } = {},
): Promise<{ didRefresh: boolean }> {
  const db = dependencies.db ?? getDb();
  const [chapter] = await db
    .select({
      name: chapters.name,
      content: chapters.content,
      synopsis: chapters.synopsis,
      synopsisSourceHash: chapters.synopsisSourceHash,
      synopsisUpdatedAt: chapters.synopsisUpdatedAt,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.id, input.chapterId),
        eq(chapters.storyId, input.storyId),
      ),
    )
    .limit(1);

  if (!chapter) {
    throw new ActionError("BAD_REQUEST", "The chapter could not be found.");
  }

  const eligible = isChapterSynopsisWorthGenerating(chapter.content);
  if (
    eligible &&
    chapter.synopsis.trim() &&
    !isChapterSynopsisStale(chapter.content, chapter.synopsisSourceHash)
  ) {
    return { didRefresh: false };
  }
  if (
    !eligible &&
    !chapter.synopsis &&
    !chapter.synopsisSourceHash &&
    !chapter.synopsisUpdatedAt
  ) {
    return { didRefresh: false };
  }

  const result = eligible
    ? await (dependencies.generate ?? generateStoryChapterSynopsis)({
        content: chapter.content,
        name: chapter.name,
      })
    : null;
  if (eligible && !result) {
    return { didRefresh: false };
  }

  const updated = await db
    .update(chapters)
    .set({
      synopsis: result?.synopsis ?? "",
      synopsisSourceHash: result?.sourceHash ?? "",
      synopsisUpdatedAt: result ? day().toISOString() : null,
    })
    .where(
      and(
        eq(chapters.id, input.chapterId),
        eq(chapters.storyId, input.storyId),
        eq(chapters.content, chapter.content),
        eq(chapters.synopsisSourceHash, chapter.synopsisSourceHash),
        eq(chapters.synopsis, chapter.synopsis),
      ),
    )
    .returning({ id: chapters.id });

  return { didRefresh: updated.length > 0 };
}
