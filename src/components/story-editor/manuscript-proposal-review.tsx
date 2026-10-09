"use client";

import { Check, Undo2, X } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { Button } from "@/components/common/button";
import type {
  ManuscriptProposal,
  ManuscriptProposalDecision,
} from "@/lib/story-manuscript-contract";

type ManuscriptProposalReviewProps = {
  proposal: ManuscriptProposal;
  disabled: boolean;
  pendingDecision?: ManuscriptProposalDecision;
  error?: string;
  onResolve: (
    proposal: ManuscriptProposal,
    decision: ManuscriptProposalDecision,
  ) => Promise<void>;
};

const STATUS_LABELS = {
  pending: "Awaiting your approval",
  accepted: "Applied to manuscript",
  rejected: "Denied · manuscript unchanged",
  undone: "Undone · original text restored",
} as const;

export function ManuscriptProposalReview({
  proposal,
  disabled,
  pendingDecision,
  error,
  onResolve,
}: ManuscriptProposalReviewProps) {
  const [showMarkdown, setShowMarkdown] = useState(false);

  return (
    <section
      aria-label="Proposed manuscript edits"
      aria-busy={Boolean(pendingDecision)}
      className="grid min-w-0 gap-3 rounded-md border border-border bg-card/70 p-3"
    >
      <div className="grid gap-1">
        <h3 className="text-label">Manuscript edits</h3>
        <p className="whitespace-pre-wrap break-words text-label-sm font-normal leading-5">
          {proposal.summary}
        </p>
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {pendingDecision === "approve"
            ? "Applying edits…"
            : pendingDecision === "deny"
              ? "Denying edits…"
              : pendingDecision === "undo"
                ? "Restoring original text…"
                : STATUS_LABELS[proposal.status]}
        </p>
      </div>

      <Button
        aria-pressed={showMarkdown}
        className="w-fit"
        onClick={() => setShowMarkdown((current) => !current)}
        size="sm"
        type="button"
        variant="ghost"
      >
        {showMarkdown ? "Show formatted text" : "Show Markdown"}
      </Button>
      <div className="grid min-w-0 gap-2">
        {proposal.chapters.map((chapter) => (
          <details
            className="min-w-0 rounded-md border border-border/80"
            key={chapter.chapterId}
            open
          >
            <summary className="cursor-pointer px-2.5 py-2 text-label-sm">
              {chapter.chapterName}
              <span className="ml-1.5 text-caption font-normal text-muted-foreground">
                {chapter.edits.length}{" "}
                {chapter.edits.length === 1 ? "edit" : "edits"}
              </span>
            </summary>
            <div className="grid min-w-0 gap-3 border-border/80 border-t p-2.5">
              <a
                className="w-fit text-caption text-primary underline-offset-4 hover:underline"
                href={`#chapter-${chapter.chapterId}`}
              >
                Go to chapter
              </a>
              {chapter.edits.map((edit) => (
                <div className="grid min-w-0 gap-1.5" key={edit.start}>
                  <ManuscriptExcerpt
                    label="Before"
                    text={edit.before}
                    showMarkdown={showMarkdown}
                  />
                  <ManuscriptExcerpt
                    label="After"
                    text={edit.after}
                    showMarkdown={showMarkdown}
                  />
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}

      {proposal.status === "pending" ? (
        <div className="grid gap-2">
          <p className="text-caption text-muted-foreground">
            Approve applies all edits together.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled}
              leftSection={<Check aria-hidden="true" />}
              loading={pendingDecision === "approve"}
              onClick={() => void onResolve(proposal, "approve")}
              size="sm"
              type="button"
            >
              Approve
            </Button>
            <Button
              disabled={disabled}
              leftSection={<X aria-hidden="true" />}
              loading={pendingDecision === "deny"}
              onClick={() => void onResolve(proposal, "deny")}
              size="sm"
              type="button"
              variant="outline"
            >
              Deny
            </Button>
          </div>
        </div>
      ) : proposal.status === "accepted" ? (
        <div className="grid justify-items-start gap-2">
          <Button
            disabled={disabled}
            leftSection={<Undo2 aria-hidden="true" />}
            loading={pendingDecision === "undo"}
            onClick={() => void onResolve(proposal, "undo")}
            size="sm"
            type="button"
            variant="outline"
          >
            Undo edits
          </Button>
          <p className="text-caption text-muted-foreground">
            Undo restores all affected chapters if they have not changed since
            approval.
          </p>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        Send another message to request a revised proposal.
      </p>
    </section>
  );
}

function ManuscriptExcerpt({
  label,
  text,
  showMarkdown,
}: {
  label: "Before" | "After";
  text: string;
  showMarkdown: boolean;
}) {
  return (
    <div
      className={
        label === "Before"
          ? "min-w-0 rounded border border-border bg-muted/35 p-2"
          : "min-w-0 rounded border border-primary/30 bg-primary/5 p-2"
      }
    >
      <p className="mb-1 text-caption font-semibold text-muted-foreground">
        {label}
      </p>
      {text.length === 0 ? (
        <p className="text-caption italic text-muted-foreground">
          {label === "Before" ? "Empty chapter" : "Text removed"}
        </p>
      ) : (
        <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-content text-[0.8125rem] leading-6">
          {showMarkdown ? text : renderManuscriptEmphasis(text)}
        </div>
      )}
    </div>
  );
}

// Manuscripts support emphasis only. React text nodes keep HTML and links inert.
function renderManuscriptEmphasis(text: string): ReactNode {
  type Frame = { delimiter: string; nodes: ReactNode[]; start: number };
  const frames: Frame[] = [{ delimiter: "", nodes: [], start: 0 }];
  let cursor = 0;

  function top() {
    return frames[frames.length - 1];
  }

  function closeFrame() {
    const frame = frames.pop();
    if (!frame) return;
    const children = frame.nodes;
    top().nodes.push(
      frame.delimiter.length === 3 ? (
        <strong key={frame.start}>
          <em>{children}</em>
        </strong>
      ) : frame.delimiter.length === 2 ? (
        <strong key={frame.start}>{children}</strong>
      ) : (
        <em key={frame.start}>{children}</em>
      ),
    );
  }

  for (const match of text.matchAll(/\\[\\*_]|\*+|_+/g)) {
    const start = match.index;
    top().nodes.push(text.slice(cursor, start));
    const token = match[0];
    cursor = start + token.length;
    if (token.startsWith("\\")) {
      top().nodes.push(token.slice(1));
      continue;
    }
    const previous = text[start - 1] ?? "";
    const next = text[cursor] ?? "";
    const intrawordUnderscore =
      token[0] === "_" &&
      /[\p{L}\p{N}]/u.test(previous) &&
      /[\p{L}\p{N}]/u.test(next);
    if (token.length > 3 || intrawordUnderscore) {
      top().nodes.push(token);
      continue;
    }
    let remaining = token.length;
    if (previous && !/\s/.test(previous)) {
      while (
        frames.length > 1 &&
        top().delimiter[0] === token[0] &&
        top().delimiter.length <= remaining
      ) {
        remaining -= top().delimiter.length;
        closeFrame();
      }
    }
    if (remaining === 0) continue;
    const delimiter = token.slice(0, remaining);
    if (next && !/\s/.test(next) && frames.length < 16) {
      frames.push({ delimiter, nodes: [], start });
    } else {
      top().nodes.push(delimiter);
    }
  }
  top().nodes.push(text.slice(cursor));
  while (frames.length > 1) {
    const frame = frames.pop();
    if (frame)
      top().nodes.push(
        <Fragment key={frame.start}>
          {frame.delimiter}
          {frame.nodes}
        </Fragment>,
      );
  }
  return top().nodes;
}
