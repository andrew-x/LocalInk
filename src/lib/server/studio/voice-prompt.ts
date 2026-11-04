import "server-only";

import type { StudioVoice, StudioVoiceSample } from "@/lib/studio/contracts";
import { effectivePickChoice } from "@/lib/studio/voice";

import { xmlField, xmlGroup } from "./prompt-kit";

/** Shared by the beat prompt and the rewrite prompt. */
export const STUDIO_PROSE_RULE_LINES: readonly string[] = [
  "- Stay in the moment. Fights, chases, intimate scenes between adults, and other big moments play out on the page as they happen, beat by beat, through the narrator's senses and thoughts. Do not skip ahead, summarize, cut away, or fade to black.",
  "- Match intensity to the stakes. Small moments stay small; big moments get full, vivid treatment on the page.",
  '- `voice` is how this story sounds: its genre, the writer\'s own words (author="true"), their picks, and notes. Follow it over your own taste. Plain or rich language comes from it, not from you.',
  "- `voice_samples` are passages the writer approved to show the voice. Match their voice, never their content, events, or names. The sample whose kind fits this moment is the closest guide.",
];

export const STUDIO_LENGTH_RULE =
  "- Aim for roughly 150 to 450 words. A moment that is a fight, a chase, an intimate scene, or a major turn may run to about 900 words.";

/** Replaces the story's genre and voice in a prompt (voice-change previews). */
export type StudioVoiceOverride = { genre: string[]; voice: StudioVoice };

/** The `<voice>` block, or "" when genre, words, picks and notes are all empty. */
export function voicePromptSection(story: {
  genre: string[];
  instructions: string;
  voice: StudioVoice;
}): string {
  const picks = story.voice.picks.flatMap((pick) => {
    const { option, custom } = effectivePickChoice(pick);
    const text = custom ?? (option ? `${option.label}. ${option.hint}` : "");
    return text.trim() ? [xmlField("pick", text, { label: pick.label })] : [];
  });
  return xmlGroup("voice", [
    xmlField("genre", story.genre.join(", ")),
    xmlField("in_your_words", story.instructions, { author: "true" }),
    xmlGroup("picks", picks),
    xmlGroup(
      "notes",
      story.voice.notes.map((note) => xmlField("note", note.text)),
    ),
  ]);
}

/** The `<voice_samples>` block, or "" when there are no samples. */
export function voiceSamplesPromptSection(
  samples: StudioVoiceSample[],
): string {
  return xmlGroup(
    "voice_samples",
    samples.map((sample) =>
      xmlField("sample", sample.text, {
        kind: sample.kind.trim() || undefined,
      }),
    ),
  );
}
