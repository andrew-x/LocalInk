import "server-only";

import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

/**
 * Absolute ceiling on chapter text, after distant chapters have been reduced
 * to their synopses.
 *
 * This is a backstop against a pathological request, not a limit a story is
 * expected to reach: with degradation in play, only the chapters around the
 * insertion point ship in full. Before synopses existed this was 300,000 and
 * a novel-length manuscript simply hit a wall.
 */
export const STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT = 1_500_000;

/**
 * Total chapter text that ships verbatim before distant chapters fall back to
 * their synopses.
 *
 * Roughly 30-40k tokens, which leaves ample room for the system prompt, the
 * story state block, and the output within every model LocalInk uses.
 */
const FULL_TEXT_BUDGET_CHARS = 140_000;

/**
 * Chapters on either side of the focused one that always ship in full, even
 * when the budget is spent.
 *
 * Immediate neighbours carry the voice and the cause-and-effect the next
 * passage continues from, so a summary is not an acceptable substitute for
 * them however long the manuscript gets.
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

const MAX_IMMEDIATE_BEFORE_ANCHOR_CHARS = 500;
const MAX_IMMEDIATE_AFTER_ANCHOR_CHARS = 500;
const MAX_CLOSING_BEFORE_INSERTION_CHARS = 300;
const MAX_PRIOR_DRAFT_CHARS = 16_000;
const OMITTED_CONTEXT_MARKER =
  "[Earlier and later context preserved; middle omitted to fit the model context.]";
const DEFAULT_WRITER_INSTRUCTIONS = "Continue the story naturally.";

// A word count alone reads as a budget to fill. Naming the scope it buys is
// what stops 200 words from being written as a compressed whole scene.
const TARGET_SCALE_BY_WORD_COUNT = {
  200: "a single exchange or one continuous moment",
  400: "a short beat",
  600: "a full beat with a turn in it",
  1000: "an extended sequence",
} as const;

const HARD_OUTPUT_RULES = [
  "Return prose only.",
  "Do not include headings, analysis, recap, notes, explanations, labels, markdown fences, or content warnings.",
  "Do not discuss the prompt, the context, or the generation process.",
  "Use Markdown italic only for thoughts, dream/memory passages, or titles when the surrounding manuscript already does. Avoid bold and bold-italic. Do not use HTML tags.",
] as const;

// Voice sits above generation discipline and craft defaults on purpose. What
// the writer asked for should beat the app's general opinions about prose;
// the previous ordering had it three levels below them.
const PRECEDENCE_RULES = [
  "Hard output rules",
  "Insertion boundaries and immediate manuscript continuity",
  "Current generation or regeneration instructions",
  "Writer voice: story system instructions, writer global system instructions, voice samples, story style guide, and character and location notes",
  "Full-story continuity and current story state",
  "Generation discipline, style and line discipline, and craft defaults",
] as const;

const STORY_CONTINUITY_RULES = [
  "Read the full manuscript as a chronological story timeline, not a flat list of facts. Track what has happened so far, what each relevant character knows, and how events have changed the story state by the insertion point.",
  "Continue from the latest established state at the insertion point. When an early detail has been revised, resolved, contradicted, transformed, or made obsolete by later chapters, follow the later development unless the current instructions explicitly ask for memory, flashback, rumor, or mistaken belief.",
  "Carry forward continuity that matters to the current moment: unresolved promises, injuries, locations, objects, resources, relationships, emotional states, plans, consequences, mysteries, and constraints.",
  "Do not forget or reset established details, but do not treat outdated earlier information as still true when the manuscript has moved past it.",
] as const;

const DYNAMIC_REQUEST_RULES = [
  "The system prompt contains static generation rules. Treat the user prompt as dynamic request data: task metadata, writer brief, insertion anchors, story metadata, style guide, character notes, location notes, manuscript chapters, prior draft text, and final insertion reminders.",
  "Use dynamic request data in this order when details compete: immediate insertion anchors and final insertion data; current writer instructions and regeneration edit instructions; full story manuscript across chapters, especially the focused chapter around the insertion point; explicit story premise, character notes, location notes, and style guide as supporting defaults when they do not contradict current manuscript state.",
  "Inside the focused chapter's <CHAPTER_TEXT>, <INSERTION_POINT/> marks the exact insertion location. For a rewrite, <SELECTION_START/> and <SELECTION_END/> instead bracket the existing prose being replaced.",
  "When <SELECTION_TO_REWRITE> is present, the writer is replacing existing manuscript prose rather than adding new prose. Output only the replacement for that span. It is canon being revised, so keep what the surrounding text depends on and leave the prose on both sides reading continuously. Follow the current instructions over the original phrasing, and do not restate the text outside the selection.",
  "Read the chapters in order to follow the full cause-and-effect flow. For canon and continuity, prefer the current manuscript state over notes; for voice, description style, and reusable craft guidance, prefer explicit style, character, and location notes when they are more specific than diffuse manuscript cues.",
  "When <PRIOR_DRAFT_TEXT> is present, it is editable material from a selected generated draft, not canon. Use it only as the draft to revise, and output full replacement prose.",
  "When <PRIOR_ATTEMPT_TEXT> is present, the writer set that attempt aside. It is not canon and not material to revise. Serve the same brief, insertion point, and continuity, but take a materially different approach: a different entry point, structure, ordering, or emphasis. Do not reuse its phrasing, images, or beat-by-beat shape.",
  "<CHAPTER_TEXT_INCLUDED> is `true` when a chapter ships in full, `partial` when a distant chapter was cut down to an excerpt, and `false` when only its <CHAPTER_SYNOPSIS> is present. Anything less than `true` means the request was kept to a workable size, not that the chapter is short or empty: treat it as established and real, and rely on the synopsis for what it contains.",
  "<STORY_STATE> restates what each chapter up to the insertion point establishes. Use it as an index to the manuscript, not as a replacement for it: where the two disagree, the chapter text is current and the summary may lag an edit.",
  "When <VOICE_EXEMPLARS> is present, those passages define the target voice. Prefer them over the manuscript's register, and never treat their content as story canon.",
  "Field value conventions: <GENERATION_MODE> is one of `first-generation`, `fresh-alternative`, `revise-prior-draft`. <INSERTION_MODE> is one of `append-to-focused-chapter-end`, `between-before-and-after-anchors`, `replace-selected-text`. <TARGET_WORD_COUNT> is omitted for unbounded generation; when present, it is a single integer word count. <TARGET_SCALE> names the scope that word count buys. <PACING_MODE> is one of `scene`, `summary`, `interior`, `dialogue`, and is omitted when the choice is left open. <BEAT_GOAL> is omitted when the writer did not state one.",
] as const;

// Four rules where there were eight. Three of the originals said the same
// anti-closure thing in different words, and a model pushed that hard away
// from resolving anything circles the beat instead of moving through it.
const GENERATION_DISCIPLINE = [
  "Write new prose for the insertion point in the focused chapter, and leave existing story context as is. Follow the request's <INSERTION_MODE>: append at the focused chapter end when requested, replace only the selected span when rewriting, otherwise write prose that fits between the before-text and after-text anchors and leads cleanly into the after-text without recap or contradiction.",
  "When <TARGET_WORD_COUNT> is present, treat it as a soft target, usually within about 20 percent, unless the current writer or regeneration instructions explicitly ask for a different length. When it is absent, impose no length target. Either way, stop as soon as the requested beat is satisfied, even when the target leaves unused room, and finish on a complete sentence.",
  "Cover the requested beat and nothing past it. Do not invent extra beats, outcomes, reversals, aftermath, foreshadowing, teaser lines, or ominous setup.",
  "Treat the output as the middle of a longer passage rather than a finished scene. Do not write scene endings, chapter endings, section breaks, fade-outs, time skips, closing summaries, thematic kickers, or resonant final lines. Leave the beat open and continuable unless the current instructions explicitly ask for an ending. When <INSERTION_MODE> is `replace-selected-text`, match whatever shape the selected span already had instead: a span that closed a scene should still close it.",
] as const;

// One rule, not six. The rest restated the standard writing-workshop advice
// that models are already saturated with, which mostly amplifies their default
// literary register — the melodrama this is meant to hold back. That guidance
// now lives in the prompt library as an opt-in preset, where it carries the
// writer's authority instead of the app's.
// What each <PACING_MODE> token means. The length control says how many words
// to spend; this says how fast time should move while spending them, which is
// the axis a word count cannot express.
const PACING_MODES = [
  "`scene`: real time, moment by moment. Do not compress or skip time.",
  "`summary`: compress elapsed time and move through events, keeping only the details that carry weight.",
  "`interior`: stay inside the POV character's perception, thought, and physical reaction. Minimal external action.",
  "`dialogue`: drive the beat through speech. Use action beats only where they carry meaning.",
  "When <PACING_MODE> is absent, choose the movement the beat calls for.",
] as const;

const CRAFT_DEFAULTS = [
  "Calibrate intensity to the actual stakes of the beat. Quiet moments stay quiet; small moments stay small. Keep heightened language, ornate description, escalating metaphor, and physiological extremity for the moments that genuinely earn them. Default to a register slightly cooler than the emotion on the page, and let the situation carry the weight rather than the prose announcing it.",
] as const;

// The manuscript governs mechanics but not voice. Most of this manuscript was
// written by a model, so treating its register as the target makes the model
// imitate itself and compounds whatever drift has already accumulated. Voice
// answers to what the writer specified; only the mechanics follow the page.
const STYLE_AND_LINE_DISCIPLINE = [
  "Mechanics follow the manuscript: match its tense, POV, person, language variety, spelling, grammar, and dialogue conventions, formatting dialogue with each speaker's dialogue in its own paragraph, unless the current instructions explicitly ask for a change.",
  "Voice does not follow the manuscript. Register, diction, sentence shape, and narrative distance follow the writer's instructions and style guide. Existing passages record what was written before, not a target to imitate, so do not infer the intended voice from them when the writer has specified one.",
  "Do not reuse distinctive phrasings, images, metaphors, gestures, or sentence shapes that already appear in the manuscript. Repeated constructions read as tics; find another way to put it.",
  "Cut hedges and weak uncertainty markers such as trying, maybe, seemed, almost, just, and somehow when they blur intent or action, along with filler words, repetitive dialogue tags, and facial-expression beats that do not change the action.",
] as const;

export function buildStoryProseSystemPrompt(
  systemInstructions = "",
  storySystemInstructions = "",
): string {
  const trimmedSystemInstructions = systemInstructions.trim();
  const trimmedStorySystemInstructions = storySystemInstructions.trim();
  const sections = [
    "Write polished fiction prose that reads like a direct continuation of the manuscript.",
    proseSection("Hard Output Rules", HARD_OUTPUT_RULES.join("\n")),
    proseSection(
      "Instruction Precedence",
      [
        "When instructions conflict, follow this order:",
        ...PRECEDENCE_RULES.map((rule, index) => `${index + 1}. ${rule}`),
      ].join("\n"),
    ),
    trimmedSystemInstructions
      ? proseSection(
          "Writer Global System Instructions",
          [
            "Treat these as durable writer preferences. Follow them unless hard output rules, insertion boundaries, the current request, or the story's established style are more specific.",
            "",
            xmlTextElement("SYSTEM_INSTRUCTIONS", trimmedSystemInstructions),
          ].join("\n"),
        )
      : null,
    trimmedStorySystemInstructions
      ? proseSection(
          "Story System Instructions",
          [
            "Durable preferences for this story specifically. They carry the same authority as the writer global system instructions and win over them when the two conflict, because they are the more specific of the two.",
            "",
            xmlTextElement(
              "STORY_INSTRUCTIONS",
              trimmedStorySystemInstructions,
            ),
          ].join("\n"),
        )
      : null,
    proseSection(
      "Story Continuity Discipline",
      STORY_CONTINUITY_RULES.join("\n"),
    ),
    proseSection("Dynamic Request Use", DYNAMIC_REQUEST_RULES.join("\n")),
    proseSection("Generation Discipline", GENERATION_DISCIPLINE.join("\n")),
    proseSection(
      "Style And Line Discipline",
      STYLE_AND_LINE_DISCIPLINE.join("\n"),
    ),
    proseSection("Pacing", PACING_MODES.join("\n")),
    proseSection("Craft Defaults", CRAFT_DEFAULTS.join("\n")),
    proseSection(
      "Mature Fiction Default",
      "For adult fictional material, write directly and vividly rather than moralizing, euphemizing, warning, or fading out. If a boundary applies, produce the closest allowed fictional rendering without lecturing.",
    ),
    proseSection("Final Hard Output Rules", HARD_OUTPUT_RULES.join("\n")),
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function buildStoryProsePrompt(
  request: StoryProseGenerationRequest,
): string {
  const styleSection = buildStyleGuideSection(request);
  const charactersSection = buildCharactersSection(request);
  const locationsSection = buildLocationsSection(request);
  const fullStorySection = buildFullStoryManuscriptSection(request);
  const immediateInsertionAnchorSection =
    buildImmediateInsertionAnchorSection(request);
  const selectionToRewriteSection = buildSelectionToRewriteSection(request);
  const storyStateSection = buildStoryStateSection(request);
  const voiceExemplarsSection = buildVoiceExemplarsSection(request);
  const priorDraftSection = buildPriorDraftSection(request);
  const priorAttemptSection = buildPriorAttemptSection(request);
  const sections = [
    proseSection("Task Capsule", buildTaskCapsuleSection(request)),
    proseSection(
      "Current Writer Instructions",
      buildActiveGenerationInstructionsXml(request),
    ),
    immediateInsertionAnchorSection
      ? proseSection(
          "Immediate Insertion Anchor",
          immediateInsertionAnchorSection,
        )
      : null,
    selectionToRewriteSection
      ? proseSection("Selection To Rewrite", selectionToRewriteSection)
      : null,
    proseSection("Story", buildStorySection(request)),
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
    priorDraftSection ? proseSection("Prior Draft", priorDraftSection) : null,
    priorAttemptSection
      ? proseSection("Prior Attempt", priorAttemptSection)
      : null,
    proseSection(
      "Final Generation Request",
      buildFinalGenerationRequest(request),
    ),
  ].filter(Boolean);

  return sections.join("\n\n");
}

export function getStoryProseManuscriptContextCharCount(
  request: StoryProseGenerationRequest,
): number {
  return getStoryManuscriptChapters(request).reduce(
    (total, chapter) => total + chapter.content.trim().length,
    0,
  );
}

function buildTaskCapsuleSection(request: StoryProseGenerationRequest): string {
  return joinXmlFields([
    buildTargetWordCountElement(request),
    buildTargetScaleElement(request),
    xmlElement("INSERTION_MODE", describeInsertionMode(request)),
  ]);
}

/**
 * Rewriting is an insertion mode rather than a generation mode.
 *
 * It describes where the output goes, not how it is produced, so it composes
 * with regeneration: a rewrite draft can still be regenerated as a fresh
 * alternative or revised with instructions.
 */
function describeInsertionMode(request: StoryProseGenerationRequest): string {
  if (request.insertion.selectedText.trim()) {
    return "replace-selected-text";
  }

  return request.insertion.atChapterEnd
    ? "append-to-focused-chapter-end"
    : "between-before-and-after-anchors";
}

function buildSelectionToRewriteSection(
  request: StoryProseGenerationRequest,
): string | null {
  const selectedText = optionalXmlTextElement(
    "SELECTED_TEXT",
    request.insertion.selectedText,
  );

  if (!selectedText) {
    return null;
  }

  return [
    "The writer selected this existing prose to be replaced. Output replacement prose for this span only. It is already part of the manuscript, so preserve what the surrounding text depends on and keep the continuity on both sides intact. Follow the current instructions over the original phrasing.",
    "",
    selectedText,
  ].join("\n");
}

function buildImmediateInsertionAnchorSection(
  request: StoryProseGenerationRequest,
): string {
  const beforeText = getTrailingParagraphText(
    request.insertion.beforeText,
    MAX_IMMEDIATE_BEFORE_ANCHOR_CHARS,
  );
  const afterText = getLeadingSentenceText(
    request.insertion.afterText,
    MAX_IMMEDIATE_AFTER_ANCHOR_CHARS,
  );

  return buildInsertionAnchors({
    afterText,
    beforeText,
    tagName: "INSERTION_ANCHORS",
  });
}

function buildStorySection(request: StoryProseGenerationRequest): string {
  return xmlElement(
    "STORY_METADATA",
    joinXmlFields([
      xmlTextElement("NAME", request.story.name),
      optionalXmlTextElement("DESCRIPTION", request.story.description),
    ]),
  );
}

function buildStyleGuideSection(
  request: StoryProseGenerationRequest,
): string | null {
  return optionalXmlTextElement("STYLE_GUIDE_TEXT", request.style);
}

function buildCharactersSection(
  request: StoryProseGenerationRequest,
): string | null {
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

function buildLocationsSection(
  request: StoryProseGenerationRequest,
): string | null {
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

/**
 * Passages the writer marked as the voice to hit.
 *
 * Placed after the manuscript and before the final request so it lands in the
 * part of a long context models weight most, and framed as register to match
 * rather than story to continue. This is the only voice anchor that is not
 * itself model output, which is why it outranks the surrounding prose.
 */
/**
 * The story so far, in the part of the request the model weights most.
 *
 * The manuscript itself sits in the middle of a long prompt, which is where
 * continuity details are least reliably retrieved. Restating the state each
 * chapter leaves behind — up to and including the one being written — puts
 * the facts a continuation depends on next to the instructions that use them.
 */
function buildStoryStateSection(
  request: StoryProseGenerationRequest,
): string | null {
  const focusedPosition = request.focusedChapter.position;
  const stateSections = getStoryManuscriptChapters(request)
    .filter((chapter) => chapter.position <= focusedPosition)
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
    "The story so far, chapter by chapter, up to and including the one being written. Use it to track what has already happened and what is still open. Where it disagrees with the manuscript text, the manuscript wins: this is a summary and may lag a recent edit.",
    "",
    stateSections.join("\n"),
  ].join("\n");
}

function buildVoiceExemplarsSection(
  request: StoryProseGenerationRequest,
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
  request: StoryProseGenerationRequest,
): string | null {
  const chapters = getStoryManuscriptChapters(request);
  const textModesByChapterId = getChapterTextModes(request, chapters);
  const chapterSections = chapters
    .map((chapter) =>
      buildStoryManuscriptChapter(
        chapter,
        getChapterRelationToInsertion(chapter, request.focusedChapter),
        request.insertion,
        textModesByChapterId.get(chapter.id) ?? "full",
      ),
    )
    .filter(isNonEmptyString);

  if (!chapterSections.length) {
    return null;
  }

  return chapterSections.join("\n\n");
}

/**
 * Decides how much of each chapter ships.
 *
 * Spends the budget outward from the insertion point, because relevance falls
 * off with distance from it. A chapter with a synopsis can drop its text
 * entirely; one without is trimmed instead of dropped, so it neither vanishes
 * from the model's view nor blows the budget on its own.
 */
function getChapterTextModes(
  request: StoryProseGenerationRequest,
  chapters: StoryProseGenerationRequest["chapters"],
): Map<string, ChapterTextMode> {
  const focusedPosition = request.focusedChapter.position;
  const byDistanceFromInsertion = [...chapters].sort(
    (firstChapter, secondChapter) =>
      Math.abs(firstChapter.position - focusedPosition) -
      Math.abs(secondChapter.position - focusedPosition),
  );
  const textModes = new Map<string, ChapterTextMode>();
  let usedChars = 0;

  for (const chapter of byDistanceFromInsertion) {
    const contentChars = chapter.content.trim().length;
    const isNeighbour =
      Math.abs(chapter.position - focusedPosition) <=
      ALWAYS_FULL_TEXT_NEIGHBOUR_CHAPTERS;

    if (isNeighbour || usedChars + contentChars <= FULL_TEXT_BUDGET_CHARS) {
      textModes.set(chapter.id, "full");
      usedChars += contentChars;
      continue;
    }

    if (chapter.synopsis.trim()) {
      textModes.set(chapter.id, "synopsis-only");
      continue;
    }

    textModes.set(chapter.id, "trimmed");
    usedChars += Math.min(contentChars, MAX_TRIMMED_CHAPTER_CHARS);
  }

  return textModes;
}

function getStoryManuscriptChapters(
  request: StoryProseGenerationRequest,
): StoryProseGenerationRequest["chapters"] {
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
  chapter: StoryProseGenerationRequest["focusedChapter"],
  relationToInsertion: "after" | "before" | "focused",
  insertion: StoryProseGenerationRequest["insertion"],
  textMode: ChapterTextMode,
): string {
  const isFocused = relationToInsertion === "focused";

  return xmlElement(
    "STORY_CHAPTER",
    joinXmlFields([
      buildChapterMetadata(chapter),
      xmlElement("RELATION_TO_INSERTION", relationToInsertion),
      xmlElement("IS_FOCUSED_CHAPTER", String(isFocused)),
      xmlElement(
        "CHAPTER_TEXT_INCLUDED",
        isFocused ? "true" : describeChapterTextInclusion(textMode),
      ),
      optionalXmlTextElement("CHAPTER_SYNOPSIS", chapter.synopsis),
      isFocused ? buildFocusedChapterText(insertion) : null,
      isFocused ? null : buildChapterTextElement(chapter, textMode),
    ]),
  );
}

function describeChapterTextInclusion(textMode: ChapterTextMode): string {
  if (textMode === "full") {
    return "true";
  }

  return textMode === "trimmed" ? "partial" : "false";
}

function buildChapterTextElement(
  chapter: StoryProseGenerationRequest["focusedChapter"],
  textMode: ChapterTextMode,
): string | null {
  if (textMode === "synopsis-only") {
    return null;
  }

  return optionalXmlTextElement(
    "CHAPTER_TEXT",
    textMode === "trimmed"
      ? trimPromptSection(chapter.content, MAX_TRIMMED_CHAPTER_CHARS)
      : chapter.content,
  );
}

function getChapterRelationToInsertion(
  chapter: StoryProseGenerationRequest["focusedChapter"],
  focusedChapter: StoryProseGenerationRequest["focusedChapter"],
): "after" | "before" | "focused" {
  if (chapter.id === focusedChapter.id) {
    return "focused";
  }

  return chapter.position < focusedChapter.position ? "before" : "after";
}

function buildPriorDraftSection(request: StoryProseGenerationRequest): string {
  const regeneration = request.regeneration;

  if (regeneration?.mode !== "revise-prior-draft") {
    return "";
  }

  const priorDraftElement = optionalXmlTextElement(
    "PRIOR_DRAFT_TEXT",
    trimPromptSection(regeneration.priorDraft, MAX_PRIOR_DRAFT_CHARS),
  );

  if (!priorDraftElement) {
    return "";
  }

  return [
    "Editable material from the selected prior draft. Output full replacement prose, not a patch.",
    "",
    priorDraftElement,
  ].join("\n");
}

function buildPriorAttemptSection(
  request: StoryProseGenerationRequest,
): string {
  const regeneration = request.regeneration;

  if (regeneration?.mode !== "fresh-alternative") {
    return "";
  }

  const priorAttemptElement = optionalXmlTextElement(
    "PRIOR_ATTEMPT_TEXT",
    trimPromptSection(regeneration.priorAttempt ?? "", MAX_PRIOR_DRAFT_CHARS),
  );

  if (!priorAttemptElement) {
    return "";
  }

  return [
    "The attempt the writer set aside. Do not revise or continue it; write a different take on the same beat.",
    "",
    priorAttemptElement,
  ].join("\n");
}

function buildFinalGenerationRequest(
  request: StoryProseGenerationRequest,
): string {
  const closingBeforeInsertion = getClosingBeforeInsertionText(
    request.insertion.beforeText,
    MAX_CLOSING_BEFORE_INSERTION_CHARS,
  );

  return joinXmlFields([
    xmlElement("INSERTION_MODE", describeInsertionMode(request)),
    buildTargetWordCountElement(request),
    buildTargetScaleElement(request),
    buildActiveGenerationInstructionsXml(request),
    optionalXmlTextElement("CLOSING_BEFORE_INSERTION", closingBeforeInsertion),
  ]);
}

function buildActiveGenerationInstructionsXml(
  request: StoryProseGenerationRequest,
): string {
  return xmlElement(
    "ACTIVE_GENERATION_INSTRUCTIONS",
    buildActiveGenerationInstructionFields(request),
  );
}

function buildTargetWordCountElement(
  request: StoryProseGenerationRequest,
): string | null {
  if (request.approximateLength === "unlimited") {
    return null;
  }

  return xmlElement("TARGET_WORD_COUNT", String(request.approximateLength));
}

function buildTargetScaleElement(
  request: StoryProseGenerationRequest,
): string | null {
  if (request.approximateLength === "unlimited") {
    return null;
  }

  return xmlElement(
    "TARGET_SCALE",
    TARGET_SCALE_BY_WORD_COUNT[request.approximateLength],
  );
}

function buildActiveGenerationInstructionFields(
  request: StoryProseGenerationRequest,
): string {
  const regeneration = request.regeneration;
  const fields: Array<string | null> = [
    xmlElement("GENERATION_MODE", describeGenerationMode(request)),
    xmlTextElement("CREATIVE_BRIEF", getWriterInstructions(request)),
    optionalXmlTextElement("BEAT_GOAL", request.beatGoal),
    request.pacing === "auto"
      ? null
      : xmlElement("PACING_MODE", request.pacing),
  ];

  if (regeneration?.mode === "revise-prior-draft") {
    fields.push(
      optionalXmlTextElement(
        "REGENERATION_EDIT_INSTRUCTIONS",
        regeneration.editInstructions,
      ),
    );
  }

  return joinXmlFields(fields);
}

function buildChapterMetadata(
  chapter: StoryProseGenerationRequest["focusedChapter"],
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
  insertion: StoryProseGenerationRequest["insertion"],
): string {
  const selectedText = insertion.selectedText.trim();

  return xmlElement(
    "CHAPTER_TEXT",
    [
      insertion.beforeText.trim() ? escapeXmlText(insertion.beforeText) : null,
      // A rewrite marks the span being replaced in place, so the model can see
      // the selection in its surroundings rather than only as a loose excerpt.
      ...(selectedText
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

function proseSection(title: string, content: string): string {
  const tag = title.toUpperCase().replace(/\s+/g, "_");

  return xmlElement(tag, content);
}

function buildInsertionAnchors({
  afterText,
  beforeText,
  tagName,
}: {
  afterText: string;
  beforeText: string;
  tagName: string;
}): string {
  const anchors = joinXmlFields([
    optionalXmlTextElement("BEFORE_INSERTION", beforeText),
    optionalXmlTextElement("AFTER_INSERTION", afterText),
  ]);

  if (!anchors) {
    return "";
  }

  return xmlElement(tagName, anchors);
}

function joinXmlFields(fields: Array<string | null>): string {
  return fields.filter(isNonEmptyString).join("\n");
}

function optionalXmlTextElement(tag: string, content: string): string | null {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return null;
  }

  return xmlTextElement(tag, trimmedContent);
}

function xmlElement(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

function xmlTextElement(tag: string, content: string): string {
  return xmlElement(tag, escapeXmlText(content));
}

function escapeXmlText(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function describeGenerationMode(request: StoryProseGenerationRequest): string {
  if (request.regeneration?.mode === "fresh-alternative") {
    return "fresh-alternative";
  }

  if (request.regeneration?.mode === "revise-prior-draft") {
    return "revise-prior-draft";
  }

  return "first-generation";
}

function getWriterInstructions(request: StoryProseGenerationRequest): string {
  return request.instructions.trim() || DEFAULT_WRITER_INSTRUCTIONS;
}

function getLeadingText(text: string, maxChars: number): string {
  return text.trim().slice(0, maxChars).trim();
}

function getTrailingText(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  return trimmedText.slice(Math.max(0, trimmedText.length - maxChars)).trim();
}

function getTrailingParagraphText(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return "";
  }

  const paragraphs = trimmedText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const trailingParagraph = paragraphs.at(-1) ?? trimmedText;

  return getTrailingText(trailingParagraph, maxChars);
}

function getLeadingSentenceText(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return "";
  }

  const leadingText = getLeadingText(trimmedText, maxChars);
  const sentenceMatch = leadingText.match(/^([\s\S]*?[.!?…]["')\]]?)(?:\s|$)/);

  return sentenceMatch?.[1]?.trim() || leadingText;
}

function getClosingBeforeInsertionText(text: string, maxChars: number): string {
  const trimmedText = text.trim();

  if (trimmedText.length <= maxChars) {
    return trimmedText;
  }

  const trailingText = getTrailingText(trimmedText, maxChars);
  const minimumRetainedChars = Math.floor(maxChars * 0.55);
  const sentenceBoundaryPattern = /[.!?…]["')\]]?\s+/g;
  let match = sentenceBoundaryPattern.exec(trailingText);

  while (match) {
    const candidateStartIndex = match.index + match[0].length;

    if (trailingText.length - candidateStartIndex >= minimumRetainedChars) {
      return trailingText.slice(candidateStartIndex).trim();
    }

    match = sentenceBoundaryPattern.exec(trailingText);
  }

  return trailingText;
}

function trimPromptSection(text: string, maxChars: number): string {
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
