"use client";

import { useMemo } from "react";

import {
  DiffText,
  SuggestionButtons,
  SuggestionIssues,
  suggestionAnchorId,
} from "@/components/studio/ai-box/suggestion-controls";
import {
  type StudioBundleOpDtoOf,
  useBundlePreview,
} from "@/components/studio/bundles/use-bundle-preview";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { storyPatchKeys } from "@/lib/studio/bundle-contract";
import type { StudioStoryDto } from "@/lib/studio/contracts";
import {
  cleanGenre,
  describeStudioVoiceOp,
  diffStudioVoice,
  effectivePickChoice,
} from "@/lib/studio/voice";
import { cn } from "@/lib/util";

const FRAME =
  "rounded-md border border-studio-proposed/45 bg-studio-proposed/8 font-normal text-label-sm";

type PickSuggestionChoice = {
  optionId: string | null;
  custom: string | null;
};

/** One pending story.update, read against the story as it is now. */
export type VoiceSuggestion = {
  op: StudioBundleOpDtoOf<"story.update">;
  bundleId: string;
  /** The `describeStudioVoiceOp` lines for the group's label. */
  lines: string[];
  picks: Map<string, PickSuggestionChoice>;
  addedNotes: string[];
  editedNotes: Map<string, string>;
  removedNoteIds: Set<string>;
  genre: string[] | null;
  instructions: string | null;
  /** Other patched settings, which accepting this group also applies. */
  otherKeys: string[];
};

const OTHER_KEY_LABEL: Record<string, string> = {
  overview: "the overview",
  theme: "the theme",
  structureTemplate: "the structure",
  structureNotes: "the structure",
};

function build(
  op: StudioBundleOpDtoOf<"story.update">,
  bundleId: string,
  story: StudioStoryDto,
): VoiceSuggestion {
  const { patch } = op;
  const lines: string[] = [];
  const picks = new Map<string, PickSuggestionChoice>();
  const addedNotes: string[] = [];
  const editedNotes = new Map<string, string>();
  const removedNoteIds = new Set<string>();

  if (patch.voice) {
    for (const voiceOp of diffStudioVoice(story.voice, patch.voice)) {
      const text = describeStudioVoiceOp(voiceOp, story.voice);
      if (text) lines.push(text);
      if (voiceOp.kind === "choose") {
        const next = patch.voice.picks.find((p) => p.id === voiceOp.pickId);
        const current = story.voice.picks.find((p) => p.id === voiceOp.pickId);
        if (!next || !current) continue;
        const { option, custom } = effectivePickChoice(next);
        const known = option && current.options.some((o) => o.id === option.id);
        if (custom !== null || known) {
          picks.set(voiceOp.pickId, {
            optionId: custom !== null ? null : (option?.id ?? null),
            custom,
          });
        }
      } else if (voiceOp.kind === "add-note") {
        addedNotes.push(voiceOp.text);
      } else if (voiceOp.kind === "edit-note") {
        editedNotes.set(voiceOp.noteId, voiceOp.text);
      } else if (voiceOp.kind === "remove-note") {
        removedNoteIds.add(voiceOp.noteId);
      }
    }
  }

  let genre: string[] | null = null;
  if (patch.genre !== undefined) {
    const next = cleanGenre(patch.genre);
    if (next.join("\n") !== story.genre.join("\n")) {
      genre = next;
      lines.push(
        next.length > 0 ? `Genre: ${next.join(", ")}` : "Genre cleared",
      );
    }
  }

  let instructions: string | null = null;
  if (
    patch.instructions !== undefined &&
    patch.instructions !== story.instructions
  ) {
    instructions = patch.instructions;
    lines.push("In your words changed");
  }

  const otherKeys = [
    ...new Set(
      storyPatchKeys(patch).flatMap((key) =>
        OTHER_KEY_LABEL[key] ? [OTHER_KEY_LABEL[key]] : [],
      ),
    ),
  ];

  return {
    op,
    bundleId,
    lines,
    picks,
    addedNotes,
    editedNotes,
    removedNoteIds,
    genre,
    instructions,
    otherKeys,
  };
}

/**
 * The pending story.update ops that change voice, genre or In your words,
 * each as one suggestion group. Only the latest pending bundle previews in
 * place, so they clear on the next chat message like every other suggestion.
 */
export function useVoiceSuggestions(): VoiceSuggestion[] {
  const { state } = useStudioStore();
  const preview = useBundlePreview();
  const { story } = state;
  const { bundleId, voiceOps } = preview;
  return useMemo(
    () => (bundleId ? voiceOps.map((op) => build(op, bundleId, story)) : []),
    [bundleId, story, voiceOps],
  );
}

/** The pending choice for one pick, with the group that proposes it. */
export function usePickSuggestion(
  pickId: string,
): { suggestion: VoiceSuggestion; choice: PickSuggestionChoice } | null {
  const suggestions = useVoiceSuggestions();
  for (const suggestion of suggestions) {
    const choice = suggestion.picks.get(pickId);
    if (choice) return { suggestion, choice };
  }
  return null;
}

/** ✓/✕ for a whole group, from any line it shows in place. */
export function VoiceSuggestionButtons({
  suggestion,
}: {
  suggestion: VoiceSuggestion;
}) {
  return (
    <SuggestionButtons
      bundleId={suggestion.bundleId}
      label={suggestion.op.label}
      opId={suggestion.op.id}
    />
  );
}

/**
 * Each suggestion as one group at the top of the Voice tab: what it changes
 * in plain lines, and ✓/✕ that resolve the whole op. The pieces also show
 * where they land, in the picks, notes, genre and In your words below.
 */
export function VoiceSuggestionGroups() {
  const suggestions = useVoiceSuggestions();
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 px-4 pt-3">
      {suggestions.map((suggestion) => (
        <div
          className={cn(FRAME, "px-2 py-1 leading-[1.5]")}
          id={suggestionAnchorId(suggestion.bundleId, suggestion.op.id)}
          key={`${suggestion.bundleId}-${suggestion.op.id}`}
        >
          <div className="flex min-h-6 min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 text-caption text-studio-proposed">
              Suggested voice change
            </span>
            <VoiceSuggestionButtons suggestion={suggestion} />
          </div>
          {suggestion.lines.length > 0 ? (
            <ul className="flex flex-col">
              {suggestion.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>{suggestion.op.label}</p>
          )}
          {suggestion.otherKeys.length > 0 ? (
            <p className="text-caption text-muted-foreground">
              plus changes to {suggestion.otherKeys.join(" and ")}, shown in the
              AI box
            </p>
          ) : null}
          <SuggestionIssues
            bundleId={suggestion.bundleId}
            opId={suggestion.op.id}
          />
        </div>
      ))}
    </div>
  );
}

/** A violet line under the genre chips for a suggested genre. */
export function GenreSuggestion({ genre }: { genre: string[] }) {
  const suggestions = useVoiceSuggestions();
  return (
    <>
      {suggestions.map((suggestion) =>
        suggestion.genre ? (
          <div
            className="flex min-w-0 items-center gap-2 text-caption"
            key={`${suggestion.bundleId}-${suggestion.op.id}`}
          >
            <span className="min-w-0 flex-1 rounded-md bg-studio-proposed/12 px-2 py-0.5 text-studio-proposed">
              {suggestion.genre.length > 0
                ? `Suggested genre: ${suggestion.genre.join(", ")}`
                : genre.length > 0
                  ? "Suggested: clear the genre"
                  : "Suggested genre change"}
            </span>
            <VoiceSuggestionButtons suggestion={suggestion} />
          </div>
        ) : null,
      )}
    </>
  );
}

/** A violet line under In your words for a suggested rewrite of it. */
export function InstructionsSuggestion({ current }: { current: string }) {
  const suggestions = useVoiceSuggestions();
  return (
    <>
      {suggestions.map((suggestion) =>
        suggestion.instructions !== null ? (
          <div
            className="flex min-w-0 items-start gap-2 rounded-md bg-studio-proposed/8 px-2 py-0.5 text-caption leading-[1.5]"
            key={`${suggestion.bundleId}-${suggestion.op.id}`}
          >
            <p className="min-w-0 flex-1">
              <DiffText after={suggestion.instructions} before={current} />
            </p>
            <VoiceSuggestionButtons suggestion={suggestion} />
          </div>
        ) : null,
      )}
    </>
  );
}

/** Suggested new notes as ghost lines at the end of the Notes list. */
export function NoteGhosts() {
  const suggestions = useVoiceSuggestions();
  return (
    <>
      {suggestions.flatMap((suggestion) =>
        suggestion.addedNotes.map((text, index) => (
          <li
            className="flex items-start gap-1.5 rounded-md border border-studio-proposed/45 border-dashed bg-studio-proposed/8 px-1.5 py-0.5"
            // A group's added notes are positional and never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: static list.
            key={`${suggestion.bundleId}-${suggestion.op.id}-${index}`}
          >
            <span aria-hidden="true" className="text-studio-proposed">
              +
            </span>
            <span className="sr-only">Suggested note: </span>
            <span className="min-w-0 flex-1 text-label-sm text-foreground/90">
              {text}
            </span>
            <VoiceSuggestionButtons suggestion={suggestion} />
          </li>
        )),
      )}
    </>
  );
}

/** What the pending groups do to one existing note. */
export function useNoteSuggestion(noteId: string): {
  suggestion: VoiceSuggestion;
  kind: "remove" | "edit";
  text: string | null;
} | null {
  const suggestions = useVoiceSuggestions();
  for (const suggestion of suggestions) {
    if (suggestion.removedNoteIds.has(noteId)) {
      return { suggestion, kind: "remove", text: null };
    }
    const edited = suggestion.editedNotes.get(noteId);
    if (edited !== undefined) return { suggestion, kind: "edit", text: edited };
  }
  return null;
}
