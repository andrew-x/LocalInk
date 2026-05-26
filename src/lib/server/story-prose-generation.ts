import "server-only";

import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

export const STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT = 300_000;

const MAX_IMMEDIATE_BEFORE_ANCHOR_CHARS = 500;
const MAX_IMMEDIATE_AFTER_ANCHOR_CHARS = 500;
const MAX_CLOSING_BEFORE_INSERTION_CHARS = 300;
const MAX_PRIOR_DRAFT_CHARS = 16_000;
const OMITTED_CONTEXT_MARKER =
  "[Earlier and later context preserved; middle omitted to fit the model context.]";
const DEFAULT_WRITER_INSTRUCTIONS = "Continue the story naturally.";

const HARD_OUTPUT_RULES = [
  "Return prose only.",
  "Do not include headings, analysis, recap, notes, explanations, labels, markdown fences, or content warnings.",
  "Do not discuss the prompt, the context, or the generation process.",
  "Use Markdown italic only for thoughts, dream/memory passages, or titles when the surrounding manuscript already does. Avoid bold and bold-italic. Do not use HTML tags.",
] as const;

const PRECEDENCE_RULES = [
  "Hard output rules",
  "Insertion boundaries and immediate manuscript continuity",
  "Current generation or regeneration instructions",
  "Writer global system instructions",
  "Full-story continuity and current story state",
  "Generation discipline",
  "Story style guide, character/location notes, and established chapter voice",
  "Style and line discipline",
  "Craft defaults",
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
  "Inside the focused chapter's <CHAPTER_TEXT>, <INSERTION_POINT/> marks the exact insertion location.",
  "Read the chapters in order to follow the full cause-and-effect flow. For canon and continuity, prefer the current manuscript state over notes; for voice, description style, and reusable craft guidance, prefer explicit style, character, and location notes when they are more specific than diffuse manuscript cues.",
  "When <PRIOR_DRAFT_TEXT> is present, it is editable material from a selected generated draft, not canon. Use it only as the draft to revise, and output full replacement prose.",
  "Field value conventions: <GENERATION_MODE> is one of `first-generation`, `fresh-alternative`, `revise-prior-draft`. <INSERTION_MODE> is one of `append-to-focused-chapter-end`, `between-before-and-after-anchors`. <TARGET_WORD_COUNT> is omitted for unbounded generation; when present, it is a single integer word count.",
] as const;

const GENERATION_DISCIPLINE = [
  "Write new prose for the insertion point in the focused chapter. Leave existing story context as is.",
  "Follow the request's <INSERTION_MODE>: append at the focused chapter end when requested, otherwise write prose that fits between the before-text and after-text anchors and leads cleanly into the after-text without recap or contradiction.",
  "When <TARGET_WORD_COUNT> is present, treat it as a soft target, usually within about 20 percent, unless the current writer or regeneration instructions explicitly ask for a different length. When no <TARGET_WORD_COUNT> is present, do not impose a length target; continue only until the requested beat is satisfied.",
  "Follow the current beat instructions closely. Do not invent extra beats, outcomes, reversals, endings, aftermath, foreshadowing, teaser lines, or ominous setup. Write closure or foreshadowing only when the writer instructions explicitly ask for that move.",
  "Treat the output as an in-progress snippet, not a scene or chapter. Do not write scene endings, chapter endings, section breaks, fade-outs, time skips, closing summaries, thematic kickers, or final-line flourishes meant to land a beat. Stop mid-momentum on a complete sentence rather than crafting a resonant closing line, unless the writer instructions explicitly ask for an ending.",
  "Do not resolve, conclude, or wrap the moment. Leave the action, tension, conversation, or beat open and continuable. The writer will signal when an ending is wanted; until then, treat every continuation as the middle of a longer passage.",
  "Stop as soon as the continuation has satisfied the requested beat, even when the soft word target leaves unused room. Finish on a complete sentence and hand control back to the writer with forward motion or unresolved tension intact.",
  "Output only the new prose for the insertion point or replacement draft. Skip recap, filler, ornate padding, transitions, explanations of choices, or descriptions of what changed.",
] as const;

const CRAFT_DEFAULTS = [
  "Ground the scene in concrete action, sensory specificity, precise nouns, and active verbs.",
  "Write clean, vivid prose with believable cause and effect instead of abstract summary.",
  "Calibrate intensity to the actual stakes of the beat. Quiet moments stay quiet; small moments stay small. Reserve heightened language, ornate description, escalating metaphor, and physiological extremity for moments that genuinely earn it. Default to a register slightly cooler than the emotion on the page, and let the situation supply the weight rather than the prose announcing it.",
  "Keep characters driven by clear goals, pressure, authentic reactions, and distinct voices.",
  "Use subtext where it fits; let emotion surface through choices, physicality, dialogue, and implication.",
  "Write dialogue as natural edited speech: purposeful, character-specific, and shaped by tension rather than exposition.",
] as const;

const STYLE_AND_LINE_DISCIPLINE = [
  "Match the surrounding manuscript's tense, POV, person, language variety, spelling, grammar, idiom, and colloquial register unless the current instructions explicitly ask for a change.",
  "Prefer active voice, concrete verbs, precise nouns, and direct sentence construction.",
  "Use show-don't-tell as a craft bias: dramatize through action, perception, dialogue, physical response, and choice; use concise summary or interiority only when it improves pace or clarity.",
  "Avoid weak adverbs, stock intensifiers, cliches, overused phrases, and generic emotional labels. Aim for fresh, specific description.",
  "Vary sentence rhythm by mixing short, direct sentences with longer textured ones, and remove filler words that dilute momentum.",
  "Let dialogue reveal character, pressure, relationship, and story movement when dialogue is the natural vehicle. Do not force exposition into speech.",
  "Keep dialogue lean and active: avoid mushy, stalled, repetitive, or unnecessary exchanges, and make spoken lines change the scene's pressure or direction.",
  "Format dialogue conventionally, with each speaker's dialogue in its own paragraph.",
  "Use unobtrusive dialogue tags or action beats for clarity, but avoid repetitive tags and empty facial-expression beats that do not affect the action.",
  "Reduce hedging and weak uncertainty indicators such as trying, maybe, seemed, almost, just, and somehow when they blur intent or action.",
] as const;

export function buildStoryProseSystemPrompt(systemInstructions = ""): string {
  const trimmedSystemInstructions = systemInstructions.trim();
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
  const priorDraftSection = buildPriorDraftSection(request);
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
    proseSection("Story", buildStorySection(request)),
    styleSection ? proseSection("Style Guide", styleSection) : null,
    charactersSection ? proseSection("Characters", charactersSection) : null,
    locationsSection ? proseSection("Locations", locationsSection) : null,
    fullStorySection
      ? proseSection("Full Story Manuscript", fullStorySection)
      : null,
    priorDraftSection ? proseSection("Prior Draft", priorDraftSection) : null,
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
    xmlElement(
      "INSERTION_MODE",
      request.insertion.atChapterEnd
        ? "append-to-focused-chapter-end"
        : "between-before-and-after-anchors",
    ),
  ]);
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

function buildFullStoryManuscriptSection(
  request: StoryProseGenerationRequest,
): string | null {
  const chapterSections = getStoryManuscriptChapters(request)
    .map((chapter) =>
      buildStoryManuscriptChapter(
        chapter,
        getChapterRelationToInsertion(chapter, request.focusedChapter),
        request.insertion,
      ),
    )
    .filter(isNonEmptyString);

  if (!chapterSections.length) {
    return null;
  }

  return chapterSections.join("\n\n");
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
): string {
  return xmlElement(
    "STORY_CHAPTER",
    joinXmlFields([
      buildChapterMetadata(chapter),
      xmlElement("RELATION_TO_INSERTION", relationToInsertion),
      xmlElement(
        "IS_FOCUSED_CHAPTER",
        String(relationToInsertion === "focused"),
      ),
      relationToInsertion === "focused"
        ? buildFocusedChapterText(insertion)
        : optionalXmlTextElement("CHAPTER_TEXT", chapter.content),
    ]),
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

function buildFinalGenerationRequest(
  request: StoryProseGenerationRequest,
): string {
  const closingBeforeInsertion = getClosingBeforeInsertionText(
    request.insertion.beforeText,
    MAX_CLOSING_BEFORE_INSERTION_CHARS,
  );

  return joinXmlFields([
    xmlElement(
      "INSERTION_MODE",
      request.insertion.atChapterEnd
        ? "append-to-focused-chapter-end"
        : "between-before-and-after-anchors",
    ),
    buildTargetWordCountElement(request),
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

function buildActiveGenerationInstructionFields(
  request: StoryProseGenerationRequest,
): string {
  const regeneration = request.regeneration;
  const fields: Array<string | null> = [
    xmlElement("GENERATION_MODE", describeGenerationMode(request)),
    xmlTextElement("CREATIVE_BRIEF", getWriterInstructions(request)),
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
  return xmlElement(
    "CHAPTER_TEXT",
    [
      insertion.beforeText.trim() ? escapeXmlText(insertion.beforeText) : null,
      "<INSERTION_POINT/>",
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
