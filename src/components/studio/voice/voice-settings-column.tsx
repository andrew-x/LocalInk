"use client";

import { useCallback, useMemo } from "react";

import { PlainText } from "@/components/studio/outline/plain-text";
import { useSaveStory } from "@/components/studio/settings/use-save-story";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioVoiceOp } from "@/lib/studio/voice";

import { GenreChips } from "./genre-chips";
import { PickRow } from "./pick-row";
import { useAskForMoreVoicePicks } from "./use-start-voice-setup";
import { VoiceNotes } from "./voice-notes";
import { GenreSuggestion, InstructionsSuggestion } from "./voice-suggestions";

type ChooseOp = Extract<StudioVoiceOp, { kind: "choose" }>;

type VoiceSettingsColumnProps = {
  fromFeedback: ReadonlySet<string>;
  /** A pick change; the panel rewrites the visible sample after it saves. */
  onChoose: (op: ChooseOp) => void;
  onOps: (ops: StudioVoiceOp[]) => void;
};

/** Genre, the author's own words, the picks and the notes. */
export function VoiceSettingsColumn({
  fromFeedback,
  onChoose,
  onOps,
}: VoiceSettingsColumnProps) {
  const { state } = useStudioStore();
  const { story } = state;
  const saveStory = useSaveStory();
  const more = useAskForMoreVoicePicks();

  const save = useCallback(
    async (
      changed: Partial<Record<"instructions", string>>,
      final: boolean,
    ) => {
      if (changed.instructions === undefined) return true;
      const text = final ? changed.instructions.trim() : changed.instructions;
      return (await saveStory({ instructions: text })) !== null;
    },
    [saveStory],
  );
  const serverValues = useMemo(
    () => ({ instructions: story.instructions }),
    [story.instructions],
  );
  const { flush, setValue, values } = useAutosaveFields<"instructions">({
    save,
    serverValues,
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-serif text-heading">Voice</h2>
      <GenreChips
        genre={story.genre}
        onChange={(genre) => onOps([{ kind: "set-genre", genre }])}
      />
      <GenreSuggestion genre={story.genre} />
      <div className="flex flex-col gap-1">
        <p className="font-bold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]">
          In your words
        </p>
        <PlainText
          className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-label-sm font-normal text-muted-foreground leading-[1.45]"
          label="In your words"
          maxLength={8000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("instructions", event.target.value)}
          placeholder="How should it sound? Loose sentences are fine."
          value={values.instructions}
        />
        <InstructionsSuggestion current={story.instructions} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-bold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]">
          Picks{" "}
          <span className="font-medium text-muted-foreground/70 normal-case tracking-normal">
            · a dot means it&apos;s what most stories like yours do
          </span>
        </p>
        {story.voice.picks.map((pick) => (
          <PickRow
            key={pick.id}
            onChoose={onChoose}
            onRemove={(pickId) => onOps([{ kind: "remove-pick", pickId }])}
            pick={pick}
          />
        ))}
        <button
          className="w-fit cursor-pointer rounded-sm font-semibold text-caption text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          disabled={more.running}
          onClick={() => void more.start()}
          type="button"
        >
          {more.running ? "Thinking…" : "Ask me more"}
        </button>
      </div>
      <VoiceNotes
        fromFeedback={fromFeedback}
        notes={story.voice.notes}
        onChange={onOps}
      />
    </div>
  );
}
