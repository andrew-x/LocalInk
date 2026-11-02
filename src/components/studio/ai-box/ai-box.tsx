"use client";

import { ChevronDown, ChevronUp, Eye, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useWatch } from "react-hook-form";

import { ChatComposer } from "@/components/studio/chat/chat-composer";
import type { ChatTurnStatus } from "@/components/studio/chat/use-chat-turn";
import { chapterNumbers } from "@/components/studio/shared/inspect-labels";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { SuggestionBar } from "./suggestion-bar";
import { type ChatSession, useChatSession } from "./use-chat-session";
import { useSuggestionFocus } from "./use-suggestion-focus";

const ANNOUNCEMENT: Record<ChatTurnStatus, string> = {
  idle: "",
  preparing: "Sending your message.",
  streaming: "The AI is replying.",
  saving: "Saving the reply.",
  "save-failed": "The reply was not saved.",
  stopping: "Stopping the reply.",
};

/** Prompts offered while the message box is focused and empty. */
const CHIPS = [
  { label: "Plan the next chapter", prompt: "Plan the next chapter." },
  {
    label: "Check for plot holes",
    prompt:
      "Check the story so far for plot holes. Tell me what you find; don't change anything yet.",
  },
];

/** "Ch 3: The pier", a scene title, or "The pier, beat 2". */
function lookingAtLabel(
  item: StudioPlanItemDto,
  planItems: StudioPlanItemDto[],
): string {
  const title = item.title.trim();
  if (item.kind === "chapter") {
    const chapter = `Ch ${chapterNumbers(planItems).get(item.id) ?? ""}`.trim();
    return title ? `${chapter}: ${title}` : chapter;
  }
  if (item.kind === "scene") return title || "Untitled scene";
  const scene = planItems.find((candidate) => candidate.id === item.parentId);
  const beats = planItems
    .filter((candidate) => candidate.parentId === item.parentId)
    .sort((a, b) => a.position - b.position);
  const number = beats.findIndex((beat) => beat.id === item.id) + 1;
  const sceneTitle = scene?.title.trim() || "Untitled scene";
  return number > 0 ? `${sceneTitle}, beat ${number}` : sceneTitle;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The one line above the composer: the last reply, or what the turn is doing. */
function lastLine(session: ChatSession): { text: string; error?: boolean } {
  const { draft, messages, threadLoad, turn } = session;
  switch (turn.status) {
    case "preparing":
      return { text: "Sending…" };
    case "streaming": {
      if (!draft) return { text: "Thinking…" };
      const text = oneLine(draft.text);
      if (text) return { text };
      if (draft.preparingChanges) return { text: "Preparing suggestions…" };
      return { text: draft.steps.at(-1)?.label ?? "Thinking…" };
    }
    case "saving":
      return { text: "Saving the reply…" };
    case "stopping":
      return { text: "Stopping…" };
    case "save-failed":
      return {
        text: "The reply wasn't saved. Open the conversation to retry.",
        error: true,
      };
  }
  if (threadLoad === "loading") return { text: "Loading the conversation…" };
  if (threadLoad === "error") {
    return { text: "The conversation could not be loaded.", error: true };
  }
  const last = messages.at(-1);
  if (!last) return { text: "" };
  if (last.role === "user") {
    return {
      text: "No reply was saved for your last message.",
      error: true,
    };
  }
  const text = oneLine(last.content);
  if (text) return { text };
  const summary = last.bundleId
    ? oneLine(session.bundleById.get(last.bundleId)?.summary ?? "")
    : "";
  return { text: summary || "Done." };
}

/**
 * The AI box, docked under the plan: the last reply as one line (with
 * "Conversation ↑"), the suggestion bar, the "Looking at" chip, and the
 * message line, with prompt chips while it is focused and empty. It also
 * routes `focusBundleOp` to where each suggestion shows.
 */
export function AiBox() {
  const { state } = useStudioStore();
  const session = useChatSession();
  const {
    blockedReason,
    conversationOpen,
    dismissLookingAt,
    form,
    insertPrompt,
    lookingAtItemId,
    onSubmit,
    setConversationOpen,
    textareaRef,
    turn,
    turnRunning,
  } = session;
  const [composerFocused, setComposerFocused] = useState(false);
  const content = useWatch({ control: form.control, name: "content" });
  useSuggestionFocus();

  const lookingAt = useMemo(() => {
    const item = lookingAtItemId
      ? state.planItems.find((candidate) => candidate.id === lookingAtItemId)
      : undefined;
    return item ? lookingAtLabel(item, state.planItems) : null;
  }, [lookingAtItemId, state.planItems]);

  const line = lastLine(session);
  const showChips =
    composerFocused && !content?.trim() && !turnRunning && !blockedReason;

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-border/80 border-t bg-card/40 px-2.5 pt-2 pb-2.5">
      <div className="flex min-w-0 items-center gap-2 px-0.5 text-caption">
        <button
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            line.error ? "text-destructive" : "text-muted-foreground",
          )}
          onClick={() => setConversationOpen(true)}
          tabIndex={line.text ? 0 : -1}
          type="button"
        >
          <span aria-hidden="true" className="shrink-0 text-studio-proposed">
            ✦
          </span>
          <span className="truncate">
            {line.text || "Suggestions show up where they would land."}
          </span>
        </button>
        <button
          aria-expanded={conversationOpen}
          className="flex shrink-0 items-center gap-0.5 rounded-sm text-muted-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setConversationOpen(!conversationOpen)}
          type="button"
        >
          Conversation
          {conversationOpen ? (
            <ChevronDown aria-hidden="true" className="size-3" />
          ) : (
            <ChevronUp aria-hidden="true" className="size-3" />
          )}
        </button>
      </div>

      <SuggestionBar />

      {lookingAt ? (
        <span className="inline-flex w-fit max-w-full items-center gap-1 rounded-full border border-border bg-card/60 py-0.5 pr-1 pl-2 text-caption text-muted-foreground">
          <Eye aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">Looking at: {lookingAt}</span>
          <button
            aria-label="Leave this out of the next message"
            className="shrink-0 rounded-full p-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={dismissLookingAt}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ) : null}

      {/* Chips show while focus is in the message box or on a chip. */}
      {/* biome-ignore lint/a11y/useSemanticElements: it wraps a form; a fieldset around a form is not valid */}
      <div
        aria-label="Message the AI"
        className="flex flex-col gap-1.5"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setComposerFocused(false);
          }
        }}
        onFocus={() => setComposerFocused(true)}
        role="group"
      >
        {showChips ? (
          <div className="flex flex-wrap gap-1">
            {CHIPS.map((chip) => (
              <button
                className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-caption text-muted-foreground outline-none hover:border-studio-proposed/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                key={chip.label}
                onClick={() => insertPrompt(chip.prompt)}
                // Keeps the message box focused, so the chips stay put.
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
        <ChatComposer
          blockedReason={blockedReason}
          form={form}
          onStop={turn.stop}
          onSubmit={onSubmit}
          status={turn.status}
          textareaRef={textareaRef}
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {ANNOUNCEMENT[turn.status]}
      </p>
    </div>
  );
}
