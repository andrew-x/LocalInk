"use client";

import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { formResolver } from "@/lib/schemas/resolve";

/** The route trims and caps the note at 300 characters. */
const NOTE_MAX_CHARS = 300;

const noteSchema = z.object({
  note: z
    .string()
    .trim()
    .max(NOTE_MAX_CHARS, "Keep the note to 300 characters or fewer."),
});
type NoteValues = z.infer<typeof noteSchema>;

/** An optional one-line note for a redraft. It posts to the prose route, so plain useForm. */
function DraftNoteForm({
  onSubmit,
  submitLabel,
}: {
  onSubmit: (note: string) => void;
  submitLabel: string;
}) {
  const errorId = useId();
  const form = useForm<NoteValues>({
    defaultValues: { note: "" },
    resolver: formResolver(noteSchema),
  });
  const error = form.formState.errors.note?.message;

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={form.handleSubmit((values) => onSubmit(values.note))}
    >
      <div className="flex items-center gap-1.5">
        <Input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          aria-label="Note for this pass (optional)"
          autoFocus
          className="h-8"
          maxLength={NOTE_MAX_CHARS}
          placeholder="Add a note… (optional)"
          {...form.register("note")}
        />
        <Button size="sm" type="submit">
          {submitLabel}
        </Button>
      </div>
      {error ? (
        <p className="px-1 text-caption text-destructive" id={errorId}>
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** A button that opens the optional note form (Try again, Redo this beat). */
export function NotePopover({
  children,
  disabled,
  onSubmit,
  submitLabel,
  triggerClassName,
  triggerVariant,
}: {
  children: ReactNode;
  disabled?: boolean;
  onSubmit: (note: string) => void;
  submitLabel: string;
  triggerClassName?: string;
  triggerVariant: ComponentProps<typeof Button>["variant"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className={triggerClassName}
          disabled={disabled}
          size="sm"
          type="button"
          variant={triggerVariant}
        >
          {children}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(24rem,calc(100vw-2rem))] p-2"
      >
        <DraftNoteForm
          onSubmit={(note) => {
            setOpen(false);
            onSubmit(note);
          }}
          submitLabel={submitLabel}
        />
      </PopoverContent>
    </Popover>
  );
}
