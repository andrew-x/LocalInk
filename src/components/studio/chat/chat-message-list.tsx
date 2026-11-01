"use client";

import { ChevronRight, LoaderCircle } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  StudioBundleDto,
  StudioChatMessageDto,
  StudioChatStep,
} from "@/actions/studio/_types";
import { Button } from "@/components/common/button";
import { BundleReviewCard } from "@/components/studio/bundles/bundle-review-card";
import { cn } from "@/lib/util";

import type { ChatTurnDraft, ChatTurnStatus } from "./use-chat-turn";

type Line = { key: string; text: string };
type Paragraph = { key: string; lines: Line[] };

/**
 * Splits reply text into paragraphs on blank lines, keeping single newlines
 * as line breaks. Text renders as React text nodes only, so nothing the
 * model writes is ever interpreted as HTML.
 */
function toParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let index = 0;
  for (const block of text.split(/\n[^\S\n]*\n/)) {
    const trimmed = block.replace(/^\s*\n/, "").trimEnd();
    if (!trimmed.trim()) continue;
    const lines: Line[] = [];
    let lineIndex = 0;
    for (const line of trimmed.split("\n")) {
      lines.push({ key: `${index}:${lineIndex}`, text: line });
      lineIndex += 1;
    }
    paragraphs.push({ key: String(index), lines });
    index += 1;
  }
  return paragraphs;
}

function ReplyText({ text }: { text: string }) {
  const paragraphs = useMemo(() => toParagraphs(text), [text]);
  return (
    <div className="flex flex-col gap-2 break-words text-body">
      {paragraphs.map((paragraph) => (
        <p key={paragraph.key}>
          {paragraph.lines.map((line, i) => (
            <Fragment key={line.key}>
              {i > 0 ? <br /> : null}
              {line.text}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

function StepList({
  steps,
  live,
}: {
  steps: StudioChatStep[];
  /** The turn is still running: open by default, last step spinning. */
  live: boolean;
}) {
  const [open, setOpen] = useState(live);
  const listId = useId();
  const keyed = useMemo(
    () => steps.map((step, i) => ({ ...step, key: `${i}:${step.tool}` })),
    [steps],
  );
  if (steps.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        className="flex w-fit items-center gap-1 rounded-sm text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {steps.length === 1 ? "1 step" : `${steps.length} steps`}
      </button>
      {open ? (
        <ol
          className="flex flex-col gap-0.5 border-border/60 border-l pl-3"
          id={listId}
        >
          {keyed.map((step, i) => (
            <li
              className="flex items-center gap-1.5 text-caption text-muted-foreground"
              key={step.key}
            >
              {live && i === keyed.length - 1 ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-3 shrink-0 animate-spin"
                />
              ) : null}
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function UserMessage({
  content,
  children,
}: {
  content: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[90%] whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 text-body">
        <span className="sr-only">You: </span>
        {content}
      </div>
      {children}
    </div>
  );
}

function StatusLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
      {children}
    </p>
  );
}

const DRAFT_STATUS: Partial<Record<ChatTurnStatus, string>> = {
  saving: "Saving reply…",
  stopping: "Stopping…",
};

type ChatMessageListProps = {
  /** The chat tab is showing; scrolling waits until it is. */
  active: boolean;
  threadId: string | null;
  messages: StudioChatMessageDto[];
  /** The running turn's draft, when it belongs to this thread. */
  draft: ChatTurnDraft | null;
  status: ChatTurnStatus;
  loading: boolean;
  loadFailed: boolean;
  onRetryLoad: () => void;
  bundleById: Map<string, StudioBundleDto>;
  /** The generationId of an unanswered message being saved or removed. */
  orphanBusy: string | null;
  onRetrySave: () => void;
  onDiscardUnsaved: () => void;
  onSaveOrphan: (message: StudioChatMessageDto) => void;
  onDiscardOrphan: (message: StudioChatMessageDto) => void;
  /** Shown when the thread has no messages yet. */
  empty: ReactNode;
};

/** The thread's saved messages, then the running turn's draft reply. */
export function ChatMessageList({
  active,
  threadId,
  messages,
  draft,
  status,
  loading,
  loadFailed,
  onRetryLoad,
  bundleById,
  orphanBusy,
  onRetrySave,
  onDiscardUnsaved,
  onSaveOrphan,
  onDiscardOrphan,
  empty,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow new text only while the author is at the bottom.
  const stickRef = useRef(true);
  const answered = useMemo(
    () =>
      new Set(
        messages
          .filter((message) => message.role === "assistant")
          .map((message) => message.generationId),
      ),
    [messages],
  );
  const lastId = messages.at(-1)?.id ?? null;
  const turnIdle = status === "idle";

  // A new thread or a new turn starts at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: thread and generation changes are the triggers.
  useLayoutEffect(() => {
    stickRef.current = true;
  }, [threadId, draft?.generationId]);

  const contentKey = `${messages.length}:${draft?.text.length ?? -1}:${
    draft?.steps.length ?? -1
  }:${status}:${loading}`;
  // Runs before a review card's own focus scroll (that one waits a frame).
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey is the trigger.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!active || !element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [active, contentKey]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  function renderBundle(bundleId: string | null) {
    const bundle = bundleId ? bundleById.get(bundleId) : undefined;
    return bundle ? <BundleReviewCard bundle={bundle} /> : null;
  }

  const isEmpty = messages.length === 0 && !draft;

  return (
    <section
      aria-busy={loading}
      aria-label="Chat messages"
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={handleScroll}
      ref={scrollRef}
    >
      <div className="flex flex-col gap-4 p-4">
        {loading ? (
          <StatusLine>Loading chat…</StatusLine>
        ) : loadFailed ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-caption text-muted-foreground">
              This chat could not be loaded.
            </p>
            <Button
              onClick={onRetryLoad}
              size="sm"
              type="button"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : isEmpty ? (
          empty
        ) : null}

        {loading
          ? null
          : messages.map((message) => {
              if (message.role === "user") {
                const isOrphan = !answered.has(message.generationId);
                if (!isOrphan) {
                  return (
                    <UserMessage content={message.content} key={message.id} />
                  );
                }
                const busy = orphanBusy === message.generationId;
                const canSave = message.id === lastId && !draft;
                return (
                  <UserMessage content={message.content} key={message.id}>
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <span className="text-caption text-muted-foreground">
                        No reply was saved for this message.
                      </span>
                      {canSave ? (
                        <Button
                          disabled={!turnIdle || orphanBusy !== null}
                          loading={busy}
                          onClick={() => onSaveOrphan(message)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Retry save
                        </Button>
                      ) : null}
                      <Button
                        disabled={!turnIdle || orphanBusy !== null}
                        onClick={() => onDiscardOrphan(message)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Discard
                      </Button>
                    </div>
                  </UserMessage>
                );
              }
              return (
                <article
                  aria-label="Assistant reply"
                  className="flex flex-col gap-2"
                  key={message.id}
                >
                  <StepList live={false} steps={message.steps} />
                  {message.content.trim() ? (
                    <ReplyText text={message.content} />
                  ) : null}
                  {renderBundle(message.bundleId)}
                </article>
              );
            })}

        {draft && !loading ? (
          <>
            <UserMessage content={draft.userMessage.content} />
            <article
              aria-label="Assistant reply in progress"
              className="flex flex-col gap-2"
            >
              <StepList
                key={draft.generationId}
                live={status === "streaming"}
                steps={draft.steps}
              />
              {draft.text.trim() ? <ReplyText text={draft.text} /> : null}
              {status === "streaming" ? (
                draft.preparingChanges ? (
                  <StatusLine>Preparing changes…</StatusLine>
                ) : !draft.text.trim() && draft.steps.length === 0 ? (
                  <StatusLine>Thinking…</StatusLine>
                ) : null
              ) : null}
              {DRAFT_STATUS[status] ? (
                <StatusLine>{DRAFT_STATUS[status]}</StatusLine>
              ) : null}
              {status === "save-failed" ? (
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5">
                  <span className="mr-auto text-caption text-destructive">
                    This reply was not saved yet.
                  </span>
                  <Button
                    onClick={onRetrySave}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Retry save
                  </Button>
                  <Button
                    onClick={onDiscardUnsaved}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Discard
                  </Button>
                </div>
              ) : null}
            </article>
          </>
        ) : null}
      </div>
    </section>
  );
}
