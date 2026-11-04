"use client";

import { X } from "lucide-react";

import { Button } from "@/components/common/button";
import { PlainText } from "@/components/studio/outline/plain-text";
import type { StudioVoiceNote } from "@/lib/studio/contracts";
import { STUDIO_VOICE_LIMITS, type StudioVoiceOp } from "@/lib/studio/voice";

type VoiceNotesProps = {
  notes: StudioVoiceNote[];
  /** Notes the author's feedback added in this session. */
  fromFeedback: ReadonlySet<string>;
  onChange: (ops: StudioVoiceOp[]) => void;
};

/** The voice's standing notes: edit in place, delete with ×. */
export function VoiceNotes({ notes, fromFeedback, onChange }: VoiceNotesProps) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-bold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]">
        Notes
      </p>
      <ul className="flex flex-col gap-0.5">
        {notes.map((note) => (
          <li className="flex items-start gap-1.5" key={note.id}>
            <span aria-hidden="true" className="text-muted-foreground/60">
              –
            </span>
            <PlainText
              className="flex-1 text-label-sm font-normal text-muted-foreground"
              defaultValue={note.text}
              key={note.text}
              label="Voice note"
              maxLength={STUDIO_VOICE_LIMITS.noteChars}
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
            {fromFeedback.has(note.id) ? (
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
          </li>
        ))}
      </ul>
    </div>
  );
}
