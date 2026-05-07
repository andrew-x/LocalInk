import "server-only";

import type { ParsedStoryChatSlashCommand } from "@/lib/story-chat-slash-commands";

export function buildStoryChatSlashCommandPrompt(
  parsedCommand: ParsedStoryChatSlashCommand,
): string {
  switch (parsedCommand.command.name) {
    case "style":
      return buildStyleGuideCommandPrompt(parsedCommand);
    case "character":
      return buildCharacterCommandPrompt(parsedCommand);
  }
}

function buildStyleGuideCommandPrompt(
  parsedCommand: ParsedStoryChatSlashCommand,
): string {
  return commandElement(
    "STYLE_GUIDE_COMMAND",
    joinCommandFields([
      commandTextElement("VISIBLE_USER_MESSAGE", parsedCommand.rawContent),
      optionalCommandTextElement(
        "USER_EXTRA_INSTRUCTIONS",
        parsedCommand.extraInstructions,
      ),
      commandTextElement(
        "OUTPUT_CONTRACT",
        [
          "Return only the paste-ready style guide text.",
          "Do not add greetings, summaries, caveats, command explanations, or introductory lines.",
          "Do not mention the slash command, XML sections, hidden context, snapshots, or implementation details.",
          "Use plain text with concise labels or short paragraphs when useful.",
        ].join("\n"),
      ),
      commandTextElement(
        "DEFAULT_TASK",
        [
          "Create polished style guidance the writer can paste into a story style field.",
          "Make the guidance specific enough to shape future prose while remaining flexible for ordinary scene needs.",
          "Prefer actionable craft instructions over abstract adjectives.",
        ].join("\n"),
      ),
      commandTextElement(
        "FOCUS_AREAS",
        [
          "Writing style and texture.",
          "Tone and emotional temperature.",
          "Point of view, psychic distance, and narrative access.",
          "Narrative voice, diction, rhythm, and sentence shape.",
          "Dialogue style, subtext, and speech tags.",
          "Sensory priorities, description density, pacing, and scene movement.",
          "Avoidances such as melodrama, exposition habits, tonal drift, weak filtering, or over-explanation.",
        ].join("\n"),
      ),
      commandTextElement(
        "SOURCE_DISCIPLINE",
        [
          "Use the visible conversation plus hidden style and character notes as source material.",
          "Do not invent story canon, plot events, relationship facts, or manuscript details not present in that context.",
          "When context is thin, produce broadly usable style guidance instead of fabricated story specifics.",
          "Apply compatible extra instructions over the default task and focus areas.",
        ].join("\n"),
      ),
    ]),
  );
}

function buildCharacterCommandPrompt(
  parsedCommand: ParsedStoryChatSlashCommand,
): string {
  return commandElement(
    "CHARACTER_DESCRIPTION_COMMAND",
    joinCommandFields([
      commandTextElement("VISIBLE_USER_MESSAGE", parsedCommand.rawContent),
      optionalCommandTextElement(
        "USER_EXTRA_INSTRUCTIONS",
        parsedCommand.extraInstructions,
      ),
      commandTextElement(
        "OUTPUT_CONTRACT",
        [
          "Return only one paste-ready character description.",
          "Do not add greetings, summaries, caveats, command explanations, or introductory lines.",
          "Do not mention the slash command, XML sections, hidden context, snapshots, or implementation details.",
          "Use plain text with concise labels or short paragraphs when useful.",
        ].join("\n"),
      ),
      commandTextElement(
        "DEFAULT_TASK",
        [
          "Create a character description the writer can paste into a character notes field.",
          "If the writer names or describes a character, build around those details.",
          "If no target character is clear, create a compact reusable character-description frame without inventing a canon name or plot role.",
          "Prefer playable scene guidance over encyclopedia facts.",
        ].join("\n"),
      ),
      commandTextElement(
        "FOCUS_AREAS",
        [
          "Personality, temperament, and emotional defaults.",
          "Desires, fears, needs, wounds, and private logic.",
          "Contradictions, pressure points, and self-deceptions.",
          "Behavior under stress, conflict, intimacy, victory, and loss.",
          "Voice, dialogue habits, silence, humor, and tells.",
          "Relationships, loyalties, resentments, power dynamics, and social posture.",
          "Physical presence, public image, private habits, and how others read them.",
          "Scene-use guidance for choices, reactions, escalation, and change over time.",
        ].join("\n"),
      ),
      commandTextElement(
        "SOURCE_DISCIPLINE",
        [
          "Use the visible conversation plus hidden style and character notes as source material.",
          "Do not invent story canon, plot events, relationship facts, or manuscript details not present in that context.",
          "When context is thin, keep claims conditional and craft-focused instead of fabricating specifics.",
          "Apply compatible extra instructions over the default task and focus areas.",
        ].join("\n"),
      ),
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

  if (!trimmedContent) {
    return null;
  }

  return commandTextElement(tag, trimmedContent);
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
