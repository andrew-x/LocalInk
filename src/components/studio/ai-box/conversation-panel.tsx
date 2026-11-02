"use client";

import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/common/button";
import { ChatMessageList } from "@/components/studio/chat/chat-message-list";
import { ChatThreadPicker } from "@/components/studio/chat/chat-thread-picker";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { cn } from "@/lib/util";

import { useChatSession } from "./use-chat-session";

/**
 * The full conversation, as an overlay over the lower ~70% of the plan
 * pane, opened from the AI box's "Conversation ↑". New conversation and the
 * history menu live in its header. It stays mounted while closed (hidden),
 * so scroll position and expanded steps survive.
 */
export function ConversationPanel() {
  const { state } = useStudioStore();
  const session = useChatSession();
  const {
    activeThreadId,
    conversationOpen,
    deleteThread,
    draft,
    lockedThreadId,
    messages,
    openThread,
    retryLoadThread,
    retryLoadThreads,
    setConversationOpen,
    threadLoad,
    threads,
    threadsStatus,
    turn,
  } = session;

  return (
    <section
      aria-label="Conversation"
      className={cn(
        "absolute inset-x-0 bottom-0 z-20 h-[70%] min-h-48 flex-col border-border/80 border-t bg-background shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)]",
        conversationOpen ? "flex" : "hidden",
      )}
      hidden={!conversationOpen}
      onKeyDown={(event) => {
        // Keys from portaled menus and dialogs (history, delete) are theirs.
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          event.target instanceof Node &&
          event.currentTarget.contains(event.target)
        ) {
          event.preventDefault();
          setConversationOpen(false);
        }
      }}
    >
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-border/60 border-b px-2">
        <ChatThreadPicker
          activeThreadId={activeThreadId}
          lockedThreadId={lockedThreadId}
          onDelete={deleteThread}
          onNew={() => openThread(null)}
          onRetryLoad={retryLoadThreads}
          onSelect={(threadId) => openThread(threadId)}
          status={threadsStatus}
          threads={threads}
        />
        <Button
          aria-label="New conversation"
          className="size-7 shrink-0"
          disabled={activeThreadId === null}
          onClick={() => openThread(null)}
          size="icon"
          tooltip="New conversation"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
        <Button
          aria-label="Hide the conversation"
          className="size-7 shrink-0"
          onClick={() => setConversationOpen(false)}
          size="icon"
          tooltip="Hide"
          type="button"
          variant="ghost"
        >
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </Button>
      </div>

      <ChatMessageList
        active={conversationOpen && !state.readMode}
        bundleById={session.bundleById}
        draft={draft}
        empty={
          <p className="text-caption text-muted-foreground">
            Ask the AI to plan, change, or write. Talking changes nothing on its
            own: anything it suggests shows up where it would land, in the
            outline, Characters & places, or the manuscript, for you to accept
            or dismiss.
          </p>
        }
        loadFailed={threadLoad === "error"}
        loading={threadLoad === "loading"}
        messages={messages}
        onDiscardOrphan={(message) => void turn.discardOrphan(message)}
        onDiscardUnsaved={() => void turn.discardUnsaved()}
        onRetryLoad={retryLoadThread}
        onRetrySave={() => void turn.retrySave()}
        onSaveOrphan={(message) => void turn.saveOrphan(message)}
        orphanBusy={turn.orphanBusy}
        status={turn.status}
        threadId={activeThreadId}
      />
    </section>
  );
}
