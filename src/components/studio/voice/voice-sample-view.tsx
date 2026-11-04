"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import type { StudioVoiceSample } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import type { VoiceDraft } from "./use-voice-drafts";

function Paragraphs({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((part) => part.trim());
  return (
    <div
      className={cn(
        "flex flex-col gap-2 font-content text-[15px] leading-[1.75]",
        className,
      )}
    >
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}

function RewriteButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label="Write it again"
      className="size-8 text-muted-foreground"
      disabled={disabled}
      onClick={onClick}
      size="icon"
      tooltip="Write it again"
      type="button"
      variant="ghost"
    >
      <RefreshCw aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

/** "Not quite… what's off?" with an optional keep button before it. */
function FeedbackRow({
  busy,
  keepLabel,
  onKeep,
  onRewrite,
  onSend,
}: {
  busy: boolean;
  keepLabel?: ReactNode;
  onKeep?: () => void;
  onRewrite: () => void;
  onSend: (complaint: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    const complaint = text.trim();
    if (!complaint || sending) return;
    setSending(true);
    try {
      if (await onSend(complaint)) setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {onKeep ? (
        <Button
          disabled={busy || sending}
          onClick={onKeep}
          size="sm"
          type="button"
          variant="secondary"
        >
          {keepLabel}
        </Button>
      ) : null}
      <Input
        aria-label="What's off?"
        className="h-8 flex-1 text-label-sm"
        disabled={sending}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void send();
          }
        }}
        placeholder="Not quite… what's off?"
        value={text}
      />
      {text.trim() ? (
        <Button
          loading={sending}
          onClick={() => void send()}
          size="sm"
          type="button"
        >
          Fix it
        </Button>
      ) : null}
      <RewriteButton disabled={busy || sending} onClick={onRewrite} />
    </div>
  );
}

type VoiceSampleViewProps = {
  draft: VoiceDraft | undefined;
  kept: StudioVoiceSample | undefined;
  /** Writes a fresh draft; `previousText` is what is on screen now. */
  onRewrite: (previousText: string | undefined) => void;
  onKeepDraft: () => Promise<boolean>;
  onConfirmKept: () => void;
  /** Resolves true when the note was used. */
  onFeedback: (complaint: string) => Promise<boolean>;
};

/** The sample for one kind of moment, in whichever state it is in. */
export function VoiceSampleView({
  draft,
  kept,
  onRewrite,
  onKeepDraft,
  onConfirmKept,
  onFeedback,
}: VoiceSampleViewProps) {
  const [keeping, setKeeping] = useState(false);
  const [showBefore, setShowBefore] = useState(false);

  async function keepDraft() {
    setKeeping(true);
    try {
      await onKeepDraft();
    } finally {
      setKeeping(false);
    }
  }

  const keptBlock = kept ? (
    <div className="flex flex-col gap-2">
      {draft ? (
        <p className="font-semibold text-[11px] text-muted-foreground/80 uppercase tracking-wider">
          Kept version
        </p>
      ) : null}
      <Paragraphs
        className={cn(kept.stale && "text-muted-foreground")}
        text={kept.text}
      />
      {kept.stale ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-studio-proposed">
          <span className="font-semibold">Written before your changes</span>
          <Button
            onClick={() => onRewrite(kept.text)}
            size="sm"
            type="button"
            variant="outline"
          >
            Rewrite for my changes
          </Button>
          <Button
            onClick={onConfirmKept}
            size="sm"
            type="button"
            variant="ghost"
          >
            Still sounds right
          </Button>
        </div>
      ) : null}
    </div>
  ) : null;

  if (!draft) {
    if (!kept) return <WritingNotice />;
    return (
      <div className="flex flex-col gap-3">
        {keptBlock}
        {kept.stale ? null : (
          <FeedbackRow
            busy={false}
            onRewrite={() => onRewrite(kept.text)}
            onSend={onFeedback}
          />
        )}
      </div>
    );
  }

  const draftBlock =
    draft.status === "writing" ? (
      <WritingNotice />
    ) : draft.status === "failed" ? (
      <div className="flex items-center gap-2 text-label-sm font-normal text-muted-foreground">
        <span>Couldn&apos;t write this sample.</span>
        <RewriteButton onClick={() => onRewrite(draft.previousText)} />
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        {draft.changedLabel ? (
          <div className="flex flex-wrap items-center gap-x-3 text-caption text-studio-proposed">
            <span>
              Rewritten for{" "}
              <b className="font-semibold">{draft.changedLabel}</b>
            </span>
            {draft.previousText ? (
              <button
                aria-pressed={showBefore}
                className="cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setShowBefore((value) => !value)}
                type="button"
              >
                Show before
              </button>
            ) : null}
          </div>
        ) : null}
        {showBefore && draft.previousText ? (
          <Paragraphs
            className="text-[13.5px] leading-[1.6] text-muted-foreground/70 line-through"
            text={draft.previousText}
          />
        ) : null}
        <div className="rounded-lg border-studio-proposed/70 border-l-2 bg-studio-proposed/6 px-4 py-2">
          <Paragraphs className="text-foreground/90" text={draft.text ?? ""} />
        </div>
        <FeedbackRow
          busy={keeping}
          keepLabel="Sounds right"
          onKeep={() => void keepDraft()}
          onRewrite={() => onRewrite(draft.text)}
          onSend={onFeedback}
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      {draftBlock}
      {keptBlock}
    </div>
  );
}

function WritingNotice() {
  return (
    <p
      aria-live="polite"
      className="flex items-center gap-2 font-content text-[15px] text-muted-foreground italic motion-safe:animate-pulse"
    >
      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      Writing a sample…
    </p>
  );
}
