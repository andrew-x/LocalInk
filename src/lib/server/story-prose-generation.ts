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
const OPEN_ENDED_CONTINUATION_INSTRUCTION =
  "Leave the passage open for the next generation: preserve forward motion, unresolved tension, or an actionable next moment unless the current writer instructions explicitly request an ending.";

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
  "Story style guide and established chapter voice",
  "Craft defaults",
] as const;

const CRAFT_DEFAULTS = [
  "Ground the scene in concrete action, sensory specificity, precise nouns, and active verbs.",
  "Write clean, vivid prose with believable cause and effect instead of abstract summary.",
  "Keep characters driven by clear goals, pressure, authentic reactions, and distinct voices.",
  "Use subtext where it fits; let emotion surface through choices, physicality, dialogue, and implication.",
  "Write dialogue as natural edited speech: purposeful, character-specific, and shaped by tension rather than exposition.",
  "Default to continuation, not closure: leave story, chapter, and scene arcs open unless the current instructions explicitly ask for an ending.",
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
  const fullStorySection = buildFullStoryManuscriptSection(request);
  const sections = [
    proseSection("Task Capsule", buildTaskCapsuleSection(request)),
    proseSection(
      "Current Writer Instructions",
      buildCurrentWriterInstructionsSection(request),
    ),
    proseSection(
      "Immediate Insertion Anchor",
      buildImmediateInsertionAnchorSection(request),
    ),
    proseSection("Context Priority", buildContextPrioritySection()),
    proseSection("Story", buildStorySection(request)),
    styleSection ? proseSection("Style Guide", styleSection) : null,
    charactersSection ? proseSection("Characters", charactersSection) : null,
    fullStorySection
      ? proseSection("Full Story Manuscript", fullStorySection)
      : null,
    request.regeneration?.mode === "revise-prior-draft"
      ? proseSection("Prior Draft", buildPriorDraftSection(request))
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
    xmlElement(
      "TASK_GOAL",
      `Write about ${request.approximateLength} words of new prose for the insertion point in the focused chapter.`,
    ),
    xmlElement("GENERATION_MODE", describeGenerationMode(request)),
    xmlElement(
      "INSERTION_MODE",
      request.insertion.atChapterEnd
        ? "Append to the end of the focused chapter."
        : "Write prose that fits between the before-text and after-text anchors.",
    ),
    xmlElement(
      "OUTPUT_SCOPE",
      "Do not rewrite existing story context. Return only the new prose for the insertion point or replacement draft.",
    ),
    xmlElement(
      "LENGTH_TARGET",
      `Treat the ${request.approximateLength}-word target as a real soft target, usually within about 20 percent, unless current instructions explicitly ask for a different length.`,
    ),
    xmlElement(
      "OPEN_ENDED_CONTINUATION",
      "Do not conclude the story, chapter, scene, or current dramatic beat unless the current writer instructions explicitly ask for that ending.",
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

  return [
    "Highest-priority manuscript continuity. The generated prose must attach cleanly after the tight before-text and, when after-text exists, lead into it without recap or contradiction.",
    "",
    buildInsertionAnchors({
      afterText,
      beforeText,
      tagName: "INSERTION_ANCHORS",
    }),
  ].join("\n");
}

function buildContextPrioritySection(): string {
  return [
    "Use context in this order when details compete:",
    "1. Immediate insertion anchor and final generation request.",
    "2. Current writer instructions, including regeneration edit instructions when provided.",
    "3. Explicit story premise, character notes, and style guide.",
    "4. Full story manuscript across chapters, especially the focused chapter around the insertion point.",
    "",
    "Inside the focused chapter's <CHAPTER_TEXT>, <INSERTION_POINT/> marks the exact insertion location.",
    "",
    "Use the chapter manuscript text as direct continuity, but prefer explicit style and character notes when they are more specific than diffuse manuscript cues.",
  ].join("\n");
}

function buildCurrentWriterInstructionsSection(
  request: StoryProseGenerationRequest,
): string {
  return joinXmlFields([
    xmlElement(
      "INSTRUCTION_AUTHORITY",
      "High-priority creative instructions for this generation. Follow these over broad manuscript context, style defaults, and general craft defaults.",
    ),
    buildActiveGenerationInstructionsXml(request),
  ]);
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

  return [
    "Full manuscript context ordered by chapter position. Treat this as direct continuity across the story.",
    "",
    chapterSections.join("\n\n"),
  ].join("\n");
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

  return [
    "Editable material from the selected generated draft. It is not canon. Output the full replacement prose, not a patch or explanation.",
    "",
    optionalXmlTextElement(
      "PRIOR_DRAFT_TEXT",
      trimPromptSection(regeneration.priorDraft, MAX_PRIOR_DRAFT_CHARS),
    ),
  ]
    .filter(isNonEmptyString)
    .join("\n");
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
        ? "Append to the end of the focused chapter."
        : "Write prose that fits at <INSERTION_POINT/> between the before-text and after-text.",
    ),
    xmlElement(
      "LENGTH_TARGET",
      `About ${request.approximateLength} words, usually within about 20 percent, unless current writer or regeneration instructions explicitly ask for a different length.`,
    ),
    buildActiveGenerationInstructionsXml(request),
    optionalXmlTextElement("CLOSING_BEFORE_INSERTION", closingBeforeInsertion),
    xmlElement(
      "CONTINUATION_POLICY",
      [
        OPEN_ENDED_CONTINUATION_INSTRUCTION,
        "Do not force closure, wrap up the scene, summarize consequences, or make the passage feel like the end of a chapter or story unless asked.",
      ].join("\n"),
    ),
    xmlElement(
      "OUTPUT_DISCIPLINE",
      [
        "Return only the new prose.",
        "Do not pad with recap, filler, ornate description, or exposition. Do not cut off in the middle of a sentence or action.",
        "Do not summarize previous context, announce transitions, explain your choices, or describe what changed.",
      ].join("\n"),
    ),
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

function buildActiveGenerationInstructionFields(
  request: StoryProseGenerationRequest,
): string {
  const regeneration = request.regeneration;
  const fields: Array<string | null> = [
    xmlTextElement("CREATIVE_BRIEF", getWriterInstructions(request)),
    xmlElement(
      "CONTINUATION_BIAS",
      "Continue the manuscript one generation at a time. Leave room for the writer's next generation unless the brief explicitly asks for an ending.",
    ),
  ];

  if (regeneration?.mode === "fresh-alternative") {
    fields.push(
      xmlElement("REGENERATION_MODE", "Fresh alternative draft."),
      xmlElement(
        "PRIOR_DRAFT_POLICY",
        "No prior draft is included or canonical. Use the same creative brief to produce a meaningfully different option.",
      ),
    );
  }

  if (regeneration?.mode === "revise-prior-draft") {
    fields.push(
      xmlElement("REGENERATION_MODE", "Revision of the selected prior draft."),
      optionalXmlTextElement(
        "REGENERATION_EDIT_INSTRUCTIONS",
        regeneration.editInstructions,
      ),
      xmlElement(
        "PRIOR_DRAFT_POLICY",
        "The prior draft is editable material, not canon. Use it only as the draft to revise, and output the full replacement prose only.",
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
    return "fresh alternative regeneration";
  }

  if (request.regeneration?.mode === "revise-prior-draft") {
    return "revision of the selected prior draft";
  }

  return "first generation";
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
