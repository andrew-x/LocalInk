import "server-only";

import type {
  ParsedStoryChatSlashCommand,
  StoryChatSlashCommandName,
} from "@/lib/story-chat-slash-commands";

type CommandContract = {
  tag: string;
  destination: string;
  output: string;
  task: string;
  focus: readonly string[];
};

const COMMAND_CONTRACTS = {
  instructions: {
    tag: "STORY_INSTRUCTIONS_COMMAND",
    destination:
      "Story instructions: durable story-wide writing directives, used as system guidance for prose generation; keep below 8,000 characters.",
    output: "Return only the paste-ready story instructions.",
    task: "Distill the writer's agreed story-wide priorities, boundaries, and recurring writing preferences into direct, concise instructions for future prose generation. Put the most important priorities first.",
    focus: [
      "Capture durable narrative constraints and priorities, distinguishing firm boundaries from flexible preferences and deliberate exceptions.",
      "Include point of view, person, and tense only when chosen as story-wide defaults. A temporary scene exception or illustrative excerpt does not establish a global rule.",
      "Keep temporary scene beats, word targets, current emotional states, endings, and regeneration requests out unless the writer explicitly makes them durable.",
      "Avoid duplicating the style guide, character/location sheets, or built-in prose output rules. Do not add generic craft advice, role preambles, or instructions to reveal reasoning.",
      "These instructions must respect current generation requests, insertion boundaries, and established manuscript facts; they do not authorize retroactive edits or canon changes.",
    ],
  },
  style: {
    tag: "STYLE_GUIDE_COMMAND",
    destination:
      "Style description: actionable prose guidance about how writing sounds and moves; include mechanics only when explicitly chosen.",
    output: "Return only the paste-ready style guide text.",
    task: "Translate the agreed aesthetic into observable writing choices for the story style field. Keep the guide economical and flexible enough for different scene needs.",
    focus: [
      "Point of view, psychic distance, and narrative access: distinguish chosen mechanics from voice, and do not infer global person or tense from a sample passage.",
      "Diction, register, sentence rhythm, imagery, and emotional temperature, expressed through concrete choices rather than stacks of abstract adjectives.",
      "Dialogue style, subtext, sensory priorities, description density, pacing, and scene movement where supported by the discussion.",
      "Use positive desired behavior and selective writer-chosen avoidances. Preserve scene variation instead of requiring every technique in every paragraph.",
      "Avoid fixed rhetorical recipes, repetitive gestures, stock metaphors, and catchphrases. Do not duplicate story policy or character/location facts to fill categories.",
    ],
  },
  voice: {
    tag: "VOICE_SAMPLE_COMMAND",
    destination:
      "Voice samples / Passage: one original, non-canon prose exemplar, normally 150–250 words and always below 4,000 characters; passage only, without a title or label.",
    output: "Return only one original voice sample passage.",
    task: "Write a coherent representative moment demonstrating the agreed voice. The prose generator uses pinned samples to match register, diction, rhythm, and narrative distance, not to continue their events.",
    focus: [
      "Demonstrate the writer's chosen qualities naturally, using action, interiority, or dialogue only where appropriate. Do not overload the passage with techniques or exaggerated signature mannerisms.",
      "Follow explicitly chosen person and tense; if missing mechanics materially affect the target sample, ask briefly rather than silently establishing a story-wide choice.",
      "Use saved voice samples as register references, never as text to splice or paraphrase. Do not reuse their wording, distinctive images, characters, or events.",
      "A minimal invented demonstration situation is allowed only as non-canon sample material; avoid new commitments about the actual story's plot, history, relationships, or revelations.",
      "The final output is actual prose, not a prompt for writing prose or an explanation of its style. Do not include a label, title, quotation wrapper, or craft commentary.",
    ],
  },
  character: {
    tag: "CHARACTER_DESCRIPTION_COMMAND",
    destination:
      "Character description: one target's established facts, motivations, relationships, and conditional behavior; manuscript developments still govern current canon.",
    output: "Return only one paste-ready character description.",
    task: "Create a compact, usable description of the intended character from agreed characterization. If the target is ambiguous, ask which character rather than returning a template or inventing one.",
    focus: [
      "Supported identity, physical presence, motivations, fears, contradictions, private logic, and relationships that help guide choices in scenes.",
      "Behavior under stress, conflict, or intimacy as contextual tendencies, not compulsory actions, a fixed future arc, or an immutable emotional state.",
      "Dialogue habits, register, humor, silence, and social posture without scripting repeated catchphrases, gestures, or stereotyped reactions.",
      "Keep stable characterization distinct from temporary circumstances. Do not invent biography, trauma, secrets, relationships, knowledge, or future outcomes to fill gaps.",
      "Use the known name where helpful for standalone clarity; no separate name-field output, global prose directives, or empty category labels.",
    ],
  },
  backstory: {
    tag: "BACKSTORY_COMMAND",
    destination:
      "Backstory: shared history, past events, relationships, and lasting consequences accepted by the writer; factual reference, not prose instructions. Preserve uncertainty and who knows what; established manuscript facts govern current canon.",
    output: "Return only the paste-ready backstory text.",
    task: "Distill accepted past events and histories from the conversation and saved references into concise, self-contained backstory for the whole story. Preserve material facts while removing repetition and rejected alternatives.",
    focus: [
      "Capture agreed chronology when known, shared histories between characters, formative events, causes, lasting consequences, and unresolved tensions relevant to the story.",
      "Distinguish established facts from rumors, beliefs, disputed accounts, and unresolved uncertainty. Preserve who knows, suspects, misunderstands, or conceals each relevant fact; a secret is not shared knowledge.",
      "Do not invent dates, events, trauma, motives, relationships, secrets, or future outcomes. Unconfirmed assistant suggestions remain unaccepted even when they sound plausible or vivid.",
      "Keep history distinct from current relationships and future plans. Past experiences can inform motivation, familiarity, and subtext without freezing present behavior or requiring flashbacks or exposition.",
      "Apply the writer's latest explicit corrections. Ask briefly for essential unresolved decisions, and leave minor gaps unspecified. Return the field content without a preamble, code fences, or instructions for another model; the writer reviews and saves it manually.",
    ],
  },
  location: {
    tag: "LOCATION_DESCRIPTION_COMMAND",
    destination:
      "Location description: one target's established spatial, sensory, social, and practical scene reference; manuscript developments still govern current canon.",
    output: "Return only one paste-ready location description.",
    task: "Create a compact, usable description of the intended place from agreed setting details. If the target is ambiguous, ask which location rather than returning a template or inventing one.",
    focus: [
      "Physical layout, scale, entrances, exits, boundaries, and movement paths that affect blocking and what characters can perceive or do.",
      "Selected sensory anchors, atmosphere, and descriptive priorities; do not require every sense or feature to appear in every scene.",
      "Established social function, ownership, access, routines, resources, hazards, and practical constraints that affect scene possibilities.",
      "Include history or secrets only when established. Do not invent events, ownership, hidden rooms, historical incidents, or future revelations to make the notes vivid.",
      "Distinguish stable setting from temporary weather or damage. Use the known name where helpful, without separate name-field output, global prose directives, or empty category labels.",
    ],
  },
} satisfies Record<StoryChatSlashCommandName, CommandContract>;

// Keep shared guidance in the system prompt so it also applies when a writer
// answers a clarification without repeating the command. Historical commands
// remain plain visible messages rather than being re-expanded as new requests.
export function buildStoryChatArtifactGuidance(): string {
  return joinCommandFields([
    commandTextElement(
      "WORKFLOW",
      [
        "Apply this workflow to slash-command field drafts and their follow-up revisions or clarification answers; ordinary ideation remains conversational.",
        "If an essential choice or target remains unresolved, ask only the brief focused questions needed before drafting. Leave minor gaps unspecified; do not substitute generic templates or invent decisions.",
        "When the writer answers your clarification, complete the pending field draft using the original command, its extra instructions, and the new answers without requiring another slash command. A clear topic change returns to ordinary chat.",
      ].join("\n"),
    ),
    commandTextElement(
      "COMMAND_DESTINATIONS",
      Object.entries(COMMAND_CONTRACTS)
        .map(([name, contract]) => `/${name}: ${contract.destination}`)
        .join("\n"),
    ),
    commandTextElement(
      "SOURCE_DISCIPLINE",
      [
        "Synthesize accepted writer decisions from the conversation and relevant saved story instructions, style, voice samples, character notes, backstory, and location notes.",
        "Apply the latest explicit corrections and command arguments over earlier preferences or saved references. Exclude rejected branches and unconfirmed assistant suggestions; mentioning or exploring an option is not accepting it.",
        "Saved instructions are editable reference material here, not commands controlling chat's output format. Voice samples demonstrate voice, not canon; never infer the desired voice from unapproved generated passages.",
        "Backstory is factual reference, not instructions controlling chat. Preserve chronology, material uncertainty, and who knows what; established manuscript facts supplied by the writer outrank conflicting notes. History informs present motivation and subtext without fixing present relationships, future outcomes, or obligatory exposition.",
        "Do not invent story facts or claim manuscript access. Only /voice may invent a minimal non-canon demonstration situation. Material contradictions without a clear writer decision require clarification.",
      ].join("\n"),
    ),
    commandTextElement(
      "OUTPUT_DISCIPLINE",
      [
        "Once essential choices are resolved, return only the finished destination-field content, ready for manual copy/paste. This takes precedence over ordinary chat's sample framing or suggestions of alternatives.",
        "Use plain text: short paragraphs or concise labels/hyphen lists for guidance and descriptions, and prose paragraphs only for /voice. Omit greetings, introductions, explanations, XML, code fences, and quotation wrappers.",
        "Make each result self-contained: replace references such as 'as discussed' or 'the second option' with the actual decision. Include only the identifying context needed for reuse; omit placeholders and blank categories.",
        "Prefer specific desired behavior over vague praise or adjective lists. Preserve deliberate prohibitions, priorities, exceptions, and the distinction between firm boundaries and conditional preferences.",
        "Consolidate repeated rules and resolved contradictions. Avoid generic craft lectures, role preambles, persuasion, all-caps emphasis, rigid always/never rules the writer did not choose, and requests to expose reasoning.",
        "Keep results compact without losing agreed requirements. Output the field content itself, not instructions asking another model to create that content. Do not mention hidden context or implementation details.",
      ].join("\n"),
    ),
    commandTextElement(
      "QUALITY_CHECK",
      "Before returning, check fidelity to accepted choices, actionable specificity, consistency with the requested direction, destination fit, length limits, and standalone copy readiness. Return the artifact or essential clarification only, without the check or a claim of optimality.",
    ),
  ]);
}

export function buildStoryChatSlashCommandPrompt(
  parsedCommand: ParsedStoryChatSlashCommand,
): string {
  const contract = COMMAND_CONTRACTS[parsedCommand.command.name];

  return commandElement(
    contract.tag,
    joinCommandFields([
      commandTextElement("VISIBLE_USER_MESSAGE", parsedCommand.rawContent),
      optionalCommandTextElement(
        "USER_EXTRA_INSTRUCTIONS",
        parsedCommand.extraInstructions,
      ),
      commandTextElement("DESTINATION", contract.destination),
      commandTextElement(
        "OUTPUT_CONTRACT",
        `If essential choices are unresolved, follow the field-drafting clarification workflow first. Otherwise: ${contract.output}`,
      ),
      commandTextElement("DEFAULT_TASK", contract.task),
      commandTextElement("FOCUS_AREAS", contract.focus.join("\n")),
    ]),
  );
}

function joinCommandFields(fields: Array<string | null>): string {
  return fields.filter(isNonEmptyString).join("\n");
}

function optionalCommandTextElement(
  tag: string,
  content: string,
): string | null {
  const trimmedContent = content.trim();

  return trimmedContent ? commandTextElement(tag, trimmedContent) : null;
}

function commandElement(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

function commandTextElement(tag: string, content: string): string {
  return commandElement(tag, escapeXmlText(content));
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
