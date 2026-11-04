"use client";

import { X } from "lucide-react";

import { Button } from "@/components/common/button";
import { PlainText } from "@/components/studio/outline/plain-text";
import type { StudioVoiceNote } from "@/lib/studio/contracts";
import { STUDIO_VOICE_LIMITS, type StudioVoiceOp } from "@/lib/studio/voice";
import { cn } from "@/lib/util";

import {
  NoteGhosts,
  useNoteSuggestion,
  useVoiceSuggestions,
  VoiceSuggestionButtons,
} from "./voice-suggestions";

type VoiceNotesProps = {
  notes: StudioVoiceNote[];
  /** Notes the author's feedback added in this session. */
  fromFeedback: ReadonlySet<string>;
  onChange: (ops: StudioVoiceOp[]) => void;
};

function NoteItem({
  fromFeedback,
  note,
  onChange,
}: {
  fromFeedback: boolean;
  note: StudioVoiceNote;
  onChange: (ops: StudioVoiceOp[]) => void;
}) {
  const pending = useNoteSuggestion(note.id);
  return (
    <li className="flex flex-col gap-0.5">
      <div
        className={cn(
          "flex items-start gap-1.5",
          pending?.kind === "remove" &&
            "rounded-md border border-studio-proposed/45 bg-studio-proposed/8 px-1.5 py-0.5",
        )}
      >
        <span aria-hidden="true" className="text-muted-foreground/60">
          –
        </span>
        <PlainText
          className={cn(
            "flex-1 text-label-sm font-normal text-muted-foreground",
            pending?.kind === "remove" && "line-through",
          )}
          defaultValue={note.text}
          key={note.text}
          label="Voice note"
          maxLength={STUDIO_VOICE_LIMITS.editedNoteChars}
          onBlur={(event) => {
            const text = event.currentTarget.value.trim();
            if (!text) {
              event.currentTarget.value = note.text;
              return;
            }
            if (text !== note.text) {
              onChange([{ kind: "edit-note", noteId: note.id, text }]);
            }
          }}
        />
        {pending?.kind === "remove" ? (
          <>
            <span className="sr-only">Suggested removal</span>
            <VoiceSuggestionButtons suggestion={pending.suggestion} />
          </>
        ) : (
          <>
            {fromFeedback ? (
              <span className="shrink-0 pt-px text-[10.5px] text-studio-proposed">
                from your note
              </span>
            ) : null}
            <Button
              aria-label="Delete note"
              className="size-5 shrink-0 text-muted-foreground"
              onClick={() =>
                onChange([{ kind: "remove-note", noteId: note.id }])
              }
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          </>
        )}
      </div>
      {pending?.kind === "edit" && pending.text !== null ? (
        <div className="ml-4 flex items-start gap-1.5 rounded-md border border-studio-proposed/45 border-dashed bg-studio-proposed/8 px-1.5 py-0.5">
          <span className="min-w-0 flex-1 text-label-sm text-foreground/90">
            <span className="sr-only">Suggested rewording: </span>
            {pending.text}
          </span>
          <VoiceSuggestionButtons suggestion={pending.suggestion} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * The voice's standing notes: edit in place, delete with ×. Suggested notes
 * show as ghost lines, suggested removals struck through.
 */
export function VoiceNotes({ notes, fromFeedback, onChange }: VoiceNotesProps) {
  const hasGhosts = useVoiceSuggestions().some(
    (suggestion) => suggestion.addedNotes.length > 0,
  );
  if (notes.length === 0 && !hasGhosts) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-bold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]">
        Notes
      </p>
      <ul className="flex flex-col gap-0.5">
        {notes.map((note) => (
          <NoteItem
            fromFeedback={fromFeedback.has(note.id)}
            key={note.id}
            note={note}
            onChange={onChange}
          />
        ))}
        <NoteGhosts />
      </ul>
    </div>
  );
}
