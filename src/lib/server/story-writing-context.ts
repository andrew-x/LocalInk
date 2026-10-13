import "server-only";

import type { PreparedStoryContext } from "@/lib/server/story-prose-context";
import type { StoryPromptContext } from "@/lib/story-prompt-suggestions-contract";

/**
 * Total chapter text that ships verbatim before distant chapters fall back to
 * their synopses.
 *
 * Roughly 30-40k tokens, which leaves ample room for the system prompt, the
 * story state block, and the output within every model LocalInk uses.
 */
const FULL_TEXT_BUDGET_CHARS = 140_000;

/**
 * Prefer full text for these neighbours within the soft allocation budget.
 * The complete rendered request still has to fit the model's hard limit.
 *
 * Immediate neighbours carry the voice and the cause-and-effect the next
 * passage continues from, so a summary is not an acceptable substitute for
 * them unless the hard request budget requires an excerpt or valid synopsis.
 */
const ALWAYS_FULL_TEXT_NEIGHBOUR_CHAPTERS = 2;

/**
 * What a distant chapter is cut down to when it has no synopsis to fall back
 * on.
 *
 * Without this, a manuscript whose synopses have not generated yet — a fresh
 * story, or the first run after the column was added — would have nothing
 * droppable and would send every chapter in full, which is how a request
 * ends up past the model's context rather than merely large.
 */
const MAX_TRIMMED_CHAPTER_CHARS = 8_000;

type ChapterTextMode = "full" | "synopsis-only" | "trimmed";

type ChapterTextAllocation = {
  mode: ChapterTextMode;
  maxChars?: number;
};

export type ChapterTextPlan = ReadonlyMap<string, ChapterTextAllocation>;

// UTF-8 bytes conservatively bound token usage for the configured text models.
// Reserve additional room for message framing and provider-specific wrappers.
const PROMPT_FRAMING_TOKEN_RESERVE = 4_096;
const UNBOUNDED_MIN_OUTPUT_TOKEN_RESERVE = 8_192;
const MIN_CHAPTER_EXCERPT_CHARS = 512;

const OMITTED_CONTEXT_MARKER =
  "[Earlier and later context preserved; middle omitted to fit the model context.]";

export class StoryWritingContextTooLargeError extends Error {
  constructor() {
    super(
      "The story request cannot fit the writing model's context after reducing distant chapters. Shorten the focused passage or reference instructions, or refresh chapter summaries before trying again. This is a prompt-size guard; your manuscript has not been changed.",
    );
    this.name = "StoryWritingContextTooLargeError";
  }
}

export type StoryWritingModelLimits = {
  contextWindowTokens: number;
  maxCompletionTokens: number;
};

/**
 * Budget the actual escaped and bookended request, not the source manuscript.
 * Keep all fixed writer instructions and the focused chapter intact. Distant
 * chapters retain either their verified synopsis or an explicitly partial
 * excerpt; even close neighbours may be reduced at the hard context ceiling.
 */
export function buildBudgetedStoryContext(
  request: PreparedStoryContext,
  {
    system,
    contextWindowTokens,
    maxCompletionTokens,
    requestedOutputTokens,
  }: StoryWritingModelLimits & {
    system: string;
    requestedOutputTokens?: number;
  },
  renderPrompt: (allocations: ChapterTextPlan) => string,
): { prompt: string; maxOutputTokens: number; inputTokenUpperBound: number } {
  const outputReserve = Math.min(
    requestedOutputTokens ?? UNBOUNDED_MIN_OUTPUT_TOKEN_RESERVE,
    maxCompletionTokens,
  );
  const inputBudget = contextWindowTokens - outputReserve;
  const chapters = getStoryManuscriptChapters(request);
  const allocations = getChapterTextPlan(request, chapters);
  let prompt = renderPrompt(allocations);
  let inputTokenUpperBound = getPromptTokenUpperBound(system, prompt);
  const byDistanceDescending = chapters
    .filter((chapter) => chapter.id !== request.focusedChapter.id)
    .sort(
      (a, b) =>
        Math.abs(b.position - request.focusedChapter.position) -
        Math.abs(a.position - request.focusedChapter.position),
    );

  const reduceChapter = (
    chapter: StoryPromptContext["focusedChapter"],
    allocation: ChapterTextAllocation,
  ) => {
    const previous = allocations.get(chapter.id) ?? { mode: "full" };
    const relation = getChapterRelationToInsertion(
      chapter,
      request.focusedChapter,
    );
    const render = (value: ChapterTextAllocation) =>
      buildStoryManuscriptChapter(chapter, relation, request.insertion, value);
    const savedBytes =
      Buffer.byteLength(render(previous), "utf8") -
      Buffer.byteLength(render(allocation), "utf8");

    if (savedBytes > 0) {
      allocations.set(chapter.id, allocation);
      inputTokenUpperBound -= savedBytes;
    }
  };

  // First trade full chapters for summaries/excerpts, farthest first. This
  // includes neighbours only when required to fit the model's hard limit.
  for (const chapter of byDistanceDescending) {
    if (inputTokenUpperBound <= inputBudget) break;
    reduceChapter(
      chapter,
      chapter.synopsis.trim()
        ? { mode: "synopsis-only" }
        : { mode: "trimmed", maxChars: MAX_TRIMMED_CHAPTER_CHARS },
    );
  }

  // Unsummarized manuscripts still need representation of every chapter.
  // Reduce excerpt sizes in rounds, preserving at least the head and tail.
  for (const maxChars of [4_000, 2_000, 1_000, MIN_CHAPTER_EXCERPT_CHARS]) {
    for (const chapter of byDistanceDescending) {
      if (inputTokenUpperBound <= inputBudget) break;
      if (!chapter.synopsis.trim()) {
        reduceChapter(chapter, { mode: "trimmed", maxChars });
      }
    }
    if (inputTokenUpperBound <= inputBudget) break;
  }

  if (inputTokenUpperBound > inputBudget) {
    throw new StoryWritingContextTooLargeError();
  }

  // Recount the final rendered request as a backstop to the incremental budget.
  prompt = renderPrompt(allocations);
  inputTokenUpperBound = getPromptTokenUpperBound(system, prompt);
  if (inputTokenUpperBound > inputBudget) {
    throw new StoryWritingContextTooLargeError();
  }

  return {
    prompt,
    inputTokenUpperBound,
    maxOutputTokens: Math.min(
      requestedOutputTokens ?? contextWindowTokens - inputTokenUpperBound,
      maxCompletionTokens,
    ),
  };
}

function buildStorySection(request: StoryPromptContext): string {
  return xmlElement(
    "STORY_METADATA",
    joinXmlFields([
      xmlTextElement("NAME", request.story.name),
      optionalXmlTextElement("DESCRIPTION", request.story.description),
    ]),
  );
}

function buildStyleGuideSection(request: StoryPromptContext): string | null {
  return optionalXmlTextElement("STYLE_GUIDE_TEXT", request.style);
}

function buildCharactersSection(request: StoryPromptContext): string | null {
  const characterSections = request.characters
    .map((character) =>
      xmlElement(
        "CHARACTER",
        joinXmlFields([
          xmlTextElement("NAME", character.name),
          optionalXmlTextElement("DESCRIPTION", character.description),
        ]),
      ),
    )
    .filter(isNonEmptyString);

  if (!characterSections.length) {
    return null;
  }

  return xmlElement("CHARACTER_NOTES", characterSections.join("\n"));
}

function buildLocationsSection(request: StoryPromptContext): string | null {
  const locationSections = request.locations
    .map((location) =>
      xmlElement(
        "LOCATION",
        joinXmlFields([
          xmlTextElement("NAME", location.name),
          optionalXmlTextElement("DESCRIPTION", location.description),
        ]),
      ),
    )
    .filter(isNonEmptyString);

  if (!locationSections.length) {
    return null;
  }

  return xmlElement("LOCATION_NOTES", locationSections.join("\n"));
}

function buildStoryStateSection(request: StoryPromptContext): string | null {
  const focusedPosition = request.focusedChapter.position;
  const stateSections = getStoryManuscriptChapters(request)
    .filter(
      (chapter) =>
        chapter.position < focusedPosition ||
        (chapter.id === request.focusedChapter.id &&
          isFocusedChapterEndAppend(request.insertion)),
    )
    .map((chapter) =>
      chapter.synopsis.trim()
        ? xmlElement(
            "CHAPTER_STATE",
            joinXmlFields([
              xmlTextElement("TITLE", chapter.name),
              xmlElement("POSITION", String(chapter.position)),
              xmlTextElement("SYNOPSIS", chapter.synopsis),
            ]),
          )
        : null,
    )
    .filter(isNonEmptyString);

  if (!stateSections.length) {
    return null;
  }

  return [
    "Verified summaries of completed chapters before the cursor, including the focused chapter only for an end append. Track what has already happened and what is still open. Later prose is a future continuity constraint, not current character knowledge. If a summary misrepresents the manuscript, the manuscript wins.",
    "",
    stateSections.join("\n"),
  ].join("\n");
}

function buildVoiceExemplarsSection(
  request: StoryPromptContext,
): string | null {
  const exemplarSections = request.voiceExemplars
    .map((voiceExemplar) =>
      xmlElement(
        "VOICE_EXEMPLAR",
        joinXmlFields([
          xmlTextElement("LABEL", voiceExemplar.label),
          xmlTextElement("TEXT", voiceExemplar.text),
        ]),
      ),
    )
    .filter(isNonEmptyString);

  if (!exemplarSections.length) {
    return null;
  }

  return [
    "Reference passages the writer chose as representative of the target voice. Match their register, diction, sentence rhythm, and narrative distance. They outrank the surrounding manuscript on voice. They are not canon and not part of this story's events: do not reuse their content, phrasing, images, or characters.",
    "",
    exemplarSections.join("\n"),
  ].join("\n");
}

function buildFullStoryManuscriptSection(
  request: StoryPromptContext,
  chapterTextPlan?: ChapterTextPlan,
): string | null {
  const chapters = getStoryManuscriptChapters(request);
  const allocations = chapterTextPlan ?? getChapterTextPlan(request, chapters);
  const chapterSections = chapters
    .map((chapter) =>
      buildStoryManuscriptChapter(
        chapter,
        getChapterRelationToInsertion(chapter, request.focusedChapter),
        request.insertion,
        allocations.get(chapter.id) ?? { mode: "full" },
      ),
    )
    .filter(isNonEmptyString);

  if (!chapterSections.length) {
    return null;
  }

  return chapterSections.join("\n\n");
}

function getChapterTextPlan(
  request: StoryPromptContext,
  chapters: StoryPromptContext["chapters"],
): Map<string, ChapterTextAllocation> {
  const focusedPosition = request.focusedChapter.position;
  const byDistanceFromInsertion = [...chapters].sort(
    (firstChapter, secondChapter) =>
      Math.abs(firstChapter.position - focusedPosition) -
      Math.abs(secondChapter.position - focusedPosition),
  );
  const allocations = new Map<string, ChapterTextAllocation>();
  let usedChars = 0;

  for (const chapter of byDistanceFromInsertion) {
    const contentChars = chapter.content.trim().length;
    const isNeighbour =
      Math.abs(chapter.position - focusedPosition) <=
      ALWAYS_FULL_TEXT_NEIGHBOUR_CHAPTERS;

    if (isNeighbour || usedChars + contentChars <= FULL_TEXT_BUDGET_CHARS) {
      allocations.set(chapter.id, { mode: "full" });
      usedChars += contentChars;
      continue;
    }

    if (chapter.synopsis.trim()) {
      allocations.set(chapter.id, { mode: "synopsis-only" });
      continue;
    }

    allocations.set(chapter.id, {
      mode: "trimmed",
      maxChars: MAX_TRIMMED_CHAPTER_CHARS,
    });
    usedChars += Math.min(contentChars, MAX_TRIMMED_CHAPTER_CHARS);
  }

  return allocations;
}

function getStoryManuscriptChapters(
  request: StoryPromptContext,
): StoryPromptContext["chapters"] {
  const chaptersById = new Map(
    request.chapters.map((chapter) => [chapter.id, chapter] as const),
  );

  chaptersById.set(request.focusedChapter.id, request.focusedChapter);

  return Array.from(chaptersById.values()).sort(
    (firstChapter, secondChapter) =>
      firstChapter.position - secondChapter.position ||
      firstChapter.name.localeCompare(secondChapter.name),
  );
}

function buildStoryManuscriptChapter(
  chapter: StoryPromptContext["focusedChapter"],
  relationToInsertion: "after" | "before" | "focused",
  insertion: StoryPromptContext["insertion"],
  allocation: ChapterTextAllocation,
): string {
  const isFocused = relationToInsertion === "focused";
  const includeSynopsis = !isFocused || isFocusedChapterEndAppend(insertion);

  return xmlElement(
    "STORY_CHAPTER",
    joinXmlFields([
      buildChapterMetadata(chapter),
      xmlElement("RELATION_TO_INSERTION", relationToInsertion),
      xmlElement("IS_FOCUSED_CHAPTER", String(isFocused)),
      xmlElement(
        "CHAPTER_TEXT_INCLUDED",
        isFocused ? "true" : describeChapterTextInclusion(allocation.mode),
      ),
      includeSynopsis
        ? optionalXmlTextElement("CHAPTER_SYNOPSIS", chapter.synopsis)
        : null,
      isFocused ? buildFocusedChapterText(insertion) : null,
      isFocused ? null : buildChapterTextElement(chapter, allocation),
    ]),
  );
}

function isFocusedChapterEndAppend(
  insertion: StoryPromptContext["insertion"],
): boolean {
  return (
    insertion.atChapterEnd &&
    !insertion.afterText.trim() &&
    !isSelectionRewrite(insertion)
  );
}

export function isSelectionRewrite(
  insertion: StoryPromptContext["insertion"],
): boolean {
  return insertion.isRewrite === true || insertion.selectedText.length > 0;
}

function describeChapterTextInclusion(textMode: ChapterTextMode): string {
  if (textMode === "full") {
    return "true";
  }

  return textMode === "trimmed" ? "partial" : "false";
}

function buildChapterTextElement(
  chapter: StoryPromptContext["focusedChapter"],
  allocation: ChapterTextAllocation,
): string | null {
  if (allocation.mode === "synopsis-only") {
    return null;
  }

  return optionalXmlTextElement(
    "CHAPTER_TEXT",
    allocation.mode === "trimmed"
      ? trimPromptSection(
          chapter.content,
          allocation.maxChars ?? MAX_TRIMMED_CHAPTER_CHARS,
        )
      : chapter.content,
  );
}

function getChapterRelationToInsertion(
  chapter: StoryPromptContext["focusedChapter"],
  focusedChapter: StoryPromptContext["focusedChapter"],
): "after" | "before" | "focused" {
  if (chapter.id === focusedChapter.id) {
    return "focused";
  }

  return chapter.position < focusedChapter.position ? "before" : "after";
}

function buildChapterMetadata(
  chapter: StoryPromptContext["focusedChapter"],
): string {
  return xmlElement(
    "CHAPTER_METADATA",
    joinXmlFields([
      xmlTextElement("TITLE", chapter.name),
      xmlElement("POSITION", String(chapter.position)),
    ]),
  );
}

function buildFocusedChapterText(
  insertion: StoryPromptContext["insertion"],
): string {
  const selectedText = insertion.selectedText.trim();

  return xmlElement(
    "CHAPTER_TEXT",
    [
      insertion.beforeText.trim() ? escapeXmlText(insertion.beforeText) : null,
      // A rewrite marks the span being replaced in place, so the model can see
      // the selection in its surroundings rather than only as a loose excerpt.
      ...(isSelectionRewrite(insertion)
        ? [
            "<SELECTION_START/>",
            escapeXmlText(selectedText),
            "<SELECTION_END/>",
          ]
        : ["<INSERTION_POINT/>"]),
      insertion.afterText.trim() ? escapeXmlText(insertion.afterText) : null,
    ]
      .filter(isNonEmptyString)
      .join("\n"),
  );
}

export function proseSection(title: string, content: string): string {
  const tag = title.toUpperCase().replace(/\s+/g, "_");

  return xmlElement(tag, content);
}

export function joinXmlFields(fields: Array<string | null>): string {
  return fields.filter(isNonEmptyString).join("\n");
}

export function optionalXmlTextElement(
  tag: string,
  content: string,
): string | null {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return null;
  }

  return xmlTextElement(tag, trimmedContent);
}

export function xmlElement(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

export function xmlTextElement(tag: string, content: string): string {
  return xmlElement(tag, escapeXmlText(content));
}

function escapeXmlText(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isNonEmptyString(
  value: string | null | undefined,
): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function trimPromptSection(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  if (trimmedText.length <= maxChars) {
    return trimmedText;
  }

  const retainedChars = Math.max(0, maxChars - OMITTED_CONTEXT_MARKER.length);
  const headChars = Math.ceil(retainedChars * 0.6);
  const tailChars = Math.floor(retainedChars * 0.4);

  return [
    trimmedText.slice(0, headChars).trimEnd(),
    "",
    OMITTED_CONTEXT_MARKER,
    "",
    trimmedText.slice(trimmedText.length - tailChars).trimStart(),
  ].join("\n");
}

function getPromptTokenUpperBound(system: string, prompt: string): number {
  return (
    Buffer.byteLength(system, "utf8") +
    Buffer.byteLength(prompt, "utf8") +
    PROMPT_FRAMING_TOKEN_RESERVE
  );
}

/** Shared story/reference data, without a task-specific writing instruction. */
export function buildStoryContextSections(
  request: StoryPromptContext,
  chapterTextPlan?: ChapterTextPlan,
): Array<string | null> {
  const backstorySection = optionalXmlTextElement(
    "BACKSTORY",
    request.story.backstory,
  );
  const styleSection = buildStyleGuideSection(request);
  const charactersSection = buildCharactersSection(request);
  const locationsSection = buildLocationsSection(request);
  const fullStorySection = buildFullStoryManuscriptSection(
    request,
    chapterTextPlan,
  );
  const storyStateSection = buildStoryStateSection(request);
  const voiceExemplarsSection = buildVoiceExemplarsSection(request);
  return [
    proseSection("Story", buildStorySection(request)),
    backstorySection,
    styleSection ? proseSection("Style Guide", styleSection) : null,
    charactersSection ? proseSection("Characters", charactersSection) : null,
    locationsSection ? proseSection("Locations", locationsSection) : null,
    fullStorySection
      ? proseSection("Full Story Manuscript", fullStorySection)
      : null,
    storyStateSection ? proseSection("Story State", storyStateSection) : null,
    voiceExemplarsSection
      ? proseSection("Voice Exemplars", voiceExemplarsSection)
      : null,
  ];
}
