"use client";

import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/common/button";
import { countWords } from "@/lib/studio/prose-text";
import { cn } from "@/lib/util";

import { NotePopover } from "./draft-note-popover";
import { draftParagraphs, renderInline } from "./draft-text";
import {
  STUDIO_PARAGRAPH_CLASS,
  STUDIO_PROSE_CLASS,
  STUDIO_SCENE_START_CLASS,
} from "./prose-styles";
import type { BeatDraft, SceneDraft } from "./scene-draft-model";

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The violet "waiting for your OK" frame around a scene's consecutive draft
 * beats, labeled "Draft" in the margin (above the text when the pane is narrow).
 */
export function SceneDraftGroup({
  busy,
  children,
  className,
  ...props
}: ComponentProps<"section"> & { busy: boolean }) {
  return (
    <section
      aria-busy={busy}
      aria-label="AI draft"
      className={cn(
        "relative -mx-4 my-1 rounded-lg border-studio-proposed/70 border-l-2 bg-studio-proposed/6 py-1.5 pr-4 pl-[0.875rem]",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mb-1 block select-none font-sans font-semibold text-[0.6875rem] text-studio-proposed uppercase tracking-[0.1em]",
          // In the margin once the manuscript pane is wide enough for it.
          "@3xl/manuscript:absolute @3xl/manuscript:top-3 @3xl/manuscript:right-full @3xl/manuscript:mr-4 @3xl/manuscript:mb-0",
        )}
      >
        Draft
      </span>
      {children}
    </section>
  );
}

type DraftBeatProps = {
  beat: BeatDraft;
  /** 1-based position in the draft. */
  number: number;
  total: number;
  isSceneStart: boolean;
  /** Redo is offered once nothing is streaming. */
  canRedo: boolean;
  onRedo: (note: string) => void;
};

/** One drafted beat in place: its text, a queued placeholder, or a failed partial. */
export function DraftBeat({
  beat,
  canRedo,
  isSceneStart,
  number,
  onRedo,
  total,
}: DraftBeatProps) {
  if (beat.status === "queued") {
    return (
      <p
        className="font-sans text-caption text-muted-foreground italic"
        data-moment-id={beat.momentId}
      >
        …beat {number} of {total}
      </p>
    );
  }

  const paragraphs = draftParagraphs(beat.text);
  const isStreaming = beat.status === "streaming";
  const failed = beat.status === "error";
  const redo = canRedo ? (
    <NotePopover
      onSubmit={onRedo}
      submitLabel="Redo beat"
      triggerClassName={cn(
        "absolute -top-3.5 right-1 z-10 h-6 border-border bg-card px-2 font-sans text-caption text-studio-proposed shadow-xs hover:bg-muted hover:text-studio-proposed",
        "focus-visible:opacity-100 data-[state=open]:opacity-100",
        failed
          ? "opacity-100"
          : "opacity-0 group-focus-within/beat:opacity-100 group-hover/beat:opacity-100",
      )}
      triggerVariant="outline"
    >
      ↻ Redo this beat
    </NotePopover>
  ) : null;

  return (
    <div
      className={cn(
        "group/beat relative -mx-2 rounded-md px-2",
        canRedo &&
          "transition-colors hover:bg-studio-proposed/8 motion-reduce:transition-none",
      )}
      data-moment-id={beat.momentId}
    >
      <div
        className={cn(
          STUDIO_PROSE_CLASS,
          isSceneStart && STUDIO_SCENE_START_CLASS,
          failed && "opacity-60",
        )}
      >
        {paragraphs.map((paragraph) => (
          <p className={STUDIO_PARAGRAPH_CLASS} key={paragraph.key}>
            {renderInline(paragraph.text)}
          </p>
        ))}
        {isStreaming ? (
          <p
            className={cn(
              "flex items-center gap-2 font-sans text-caption text-muted-foreground italic",
              paragraphs.length > 0 && "mt-1",
            )}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-studio-proposed motion-safe:animate-pulse"
            />
            {paragraphs.length === 0
              ? `…beat ${number} of ${total} writing`
              : null}
          </p>
        ) : null}
      </div>
      {failed ? (
        <p className="mt-1 font-sans text-caption text-muted-foreground">
          This beat can&apos;t be kept as it is (it didn&apos;t finish or is no
          longer available). Redo it to continue.
        </p>
      ) : null}
      {redo}
    </div>
  );
}

function barMessage(draft: SceneDraft, title: string): ReactNode {
  switch (draft.status) {
    case "planning":
    case "streaming":
      return "Writing…";
    case "stopped":
      return "Stopped. Redo the unfinished beat, or try again.";
    case "error":
      return "Part of this draft can't be kept yet. Redo it, or try again.";
    case "ready": {
      // The refusal could be an expiry, a conflict or a hiccup; Try again
      // fixes the first, Keep again the others.
      if (draft.keepRefused) {
        return "Keep didn't go through. If the draft expired, Try again redraws the scene.";
      }
      const words = draft.beats.reduce(
        (total, beat) => total + countWords(beat.text),
        0,
      );
      return (
        <>
          <span className="font-semibold text-foreground">{title}</span>
          {` · ${plural(draft.beats.length, "beat")} · ${plural(words, "word")}`}
        </>
      );
    }
  }
}

type DraftBarProps = {
  draft: SceneDraft;
  title: string;
  /** "Scene 2 of 3", while a chapter is being written. */
  progress: string | null;
  canKeep: boolean;
  isKeeping: boolean;
  onKeep: () => void;
  onTryAgain: (note: string) => void;
  onDiscard: () => void;
};

/** The one decision under a scene draft: Keep scene, Try again (with a note), Discard. */
export function DraftBar({
  canKeep,
  draft,
  isKeeping,
  onDiscard,
  onKeep,
  onTryAgain,
  progress,
  title,
}: DraftBarProps) {
  const running = draft.status === "planning" || draft.status === "streaming";
  const replaces = draft.beats.some((beat) => beat.replacesProse);
  return (
    <div className="mt-3 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-studio-proposed/40 bg-card py-2 pr-2 pl-3 font-sans text-caption text-muted-foreground">
      <output aria-live="polite" className="mr-auto min-w-0">
        {barMessage(draft, title)}
        {progress ? ` · ${progress}` : null}
        {replaces && draft.status === "ready" ? (
          <span className="block">
            Keep replaces the current text; it stays in versions.
          </span>
        ) : null}
      </output>
      <Button
        disabled={isKeeping}
        onClick={onDiscard}
        size="sm"
        type="button"
        variant="ghost"
      >
        Discard
      </Button>
      <NotePopover
        disabled={running || isKeeping}
        onSubmit={onTryAgain}
        submitLabel="Try again"
        triggerVariant="secondary"
      >
        Try again
      </NotePopover>
      <Button
        disabled={!canKeep || isKeeping}
        loading={isKeeping}
        onClick={onKeep}
        size="sm"
        type="button"
      >
        Keep scene
      </Button>
    </div>
  );
}
