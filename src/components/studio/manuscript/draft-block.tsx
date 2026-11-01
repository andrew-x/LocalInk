"use client";

import { Fragment, type ReactNode } from "react";

import { Button } from "@/components/common/button";
import { cn } from "@/lib/util";

import {
  STUDIO_PARAGRAPH_CLASS,
  STUDIO_PROSE_CLASS,
  STUDIO_SCENE_START_CLASS,
} from "./prose-styles";
import { useWritingLoop, type WritingDraft } from "./use-writing-loop";

const INLINE_EMPHASIS =
  /(\*\*\*[^*\n]+\*\*\*|___[^_\n]+___|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

/** Renders the studio emphasis subset; anything unclosed stays literal while it streams. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  let isEmphasis = false;
  // A capturing split alternates plain text and emphasis matches.
  for (const part of text.split(INLINE_EMPHASIS)) {
    const key = `${isEmphasis ? "e" : "t"}${offset}`;
    offset += part.length;
    if (!isEmphasis) {
      nodes.push(<Fragment key={key}>{part}</Fragment>);
    } else if (/^(\*\*\*|___)/.test(part)) {
      nodes.push(
        <strong className="font-semibold italic" key={key}>
          {part.slice(3, -3)}
        </strong>,
      );
    } else if (/^(\*\*|__)/.test(part)) {
      nodes.push(
        <strong className="font-semibold" key={key}>
          {part.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>);
    }
    isEmphasis = !isEmphasis;
  }
  return nodes;
}

function draftParagraphs(text: string): { key: string; text: string }[] {
  let offset = 0;
  return text
    .split(/\n+/)
    .map((paragraph) => {
      const key = `p${offset}`;
      offset += paragraph.length + 1;
      return { key, text: paragraph.trim() };
    })
    .filter((paragraph) => paragraph.text.length > 0);
}

function statusLabel(draft: WritingDraft, isKeeping: boolean): string {
  if (isKeeping) return "Keeping…";
  if (draft.status === "streaming") return "Writing…";
  if (draft.status === "ready") return "Draft";
  if (draft.stopped) return "Stopped. A partial draft can't be kept.";
  return "This draft didn't finish.";
}

type DraftBlockProps = {
  draft: WritingDraft;
  isSceneStart: boolean;
  /** Set when the moment already has prose; that prose stays until Keep. */
  replacesProse: boolean;
};

/** A pending AI draft in the moment's place, with Keep / Try again / Stop. */
export function DraftBlock({
  draft,
  isSceneStart,
  replacesProse,
}: DraftBlockProps) {
  const loop = useWritingLoop();
  const paragraphs = draftParagraphs(draft.text);
  const isStreaming = draft.status === "streaming";
  const chain =
    loop.chain && loop.draft?.generationId === draft.generationId
      ? loop.chain
      : null;

  return (
    <section
      aria-busy={isStreaming}
      aria-label="AI draft"
      className="-mx-4 my-2 rounded-md border border-accent/45 border-dashed px-4 py-3"
    >
      <div
        className={cn(
          STUDIO_PROSE_CLASS,
          isSceneStart && STUDIO_SCENE_START_CLASS,
        )}
      >
        {paragraphs.length > 0 ? (
          paragraphs.map((paragraph) => (
            <p className={STUDIO_PARAGRAPH_CLASS} key={paragraph.key}>
              {renderInline(paragraph.text)}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">
            {isStreaming ? "Writing…" : "Nothing was written."}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-sans">
        <output
          aria-live="polite"
          className="mr-auto text-caption text-muted-foreground"
        >
          {statusLabel(draft, loop.isKeeping)}
          {chain
            ? ` · Moment ${chain.index} of ${chain.total} in this scene`
            : null}
          {replacesProse && draft.status === "ready"
            ? " · Keep replaces the text above; it stays in versions."
            : null}
        </output>
        {draft.status === "ready" || isStreaming ? (
          <Button
            disabled={isStreaming || loop.isKeeping}
            loading={loop.isKeeping}
            onClick={() => void loop.keep()}
            size="sm"
            type="button"
          >
            Keep
          </Button>
        ) : null}
        <Button
          disabled={loop.isKeeping}
          onClick={() => void loop.write(draft.momentId, { again: true })}
          size="sm"
          type="button"
          variant="outline"
        >
          Try again
        </Button>
        {isStreaming ? (
          <Button onClick={loop.stop} size="sm" type="button" variant="ghost">
            Stop
          </Button>
        ) : (
          <Button
            disabled={loop.isKeeping}
            onClick={loop.discard}
            size="sm"
            type="button"
            variant="ghost"
          >
            Discard
          </Button>
        )}
      </div>
    </section>
  );
}
