"use client";

import { ChevronDown, MessagesSquare, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { StudioChatThreadDto } from "@/actions/studio/_types";
import { Button } from "@/components/common/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import day from "@/lib/dayjs";
import { cn } from "@/lib/util";

export type ChatThreadsStatus = "idle" | "loading" | "ready" | "error";

function updatedLabel(updatedAt: string): string {
  const date = day(updatedAt);
  return date.isValid() ? date.fromNow() : "recently";
}

type ChatThreadPickerProps = {
  threads: StudioChatThreadDto[];
  status: ChatThreadsStatus;
  activeThreadId: string | null;
  /** A thread whose turn is running; it cannot be deleted until it settles. */
  lockedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNew: () => void;
  onRetryLoad: () => void;
  /** Resolves true once the thread is deleted. */
  onDelete: (threadId: string) => Promise<boolean>;
};

/** The thread list: switch, start a new chat, or delete one. */
export function ChatThreadPicker({
  threads,
  status,
  activeThreadId,
  lockedThreadId,
  onSelect,
  onNew,
  onRetryLoad,
  onDelete,
}: ChatThreadPickerProps) {
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] =
    useState<StudioChatThreadDto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const triggerLabel = activeThreadId
    ? (activeThread?.title.trim() ?? "") || "Chat"
    : "New chat";

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (await onDelete(pendingDelete.id)) setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            aria-label={`Chats. Current: ${triggerLabel}`}
            className="min-w-0 flex-1 justify-start gap-1.5 px-2"
            size="sm"
            type="button"
            variant="ghost"
          >
            <MessagesSquare aria-hidden="true" className="size-3.5" />
            <span className="truncate text-label-sm">{triggerLabel}</span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1">
          <button
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-label-sm outline-none hover:bg-muted focus-visible:bg-muted"
            onClick={() => {
              onNew();
              setOpen(false);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            New chat
          </button>
          <div className="my-1 border-border/60 border-t" />
          {status === "loading" && threads.length === 0 ? (
            <p className="px-2 py-1.5 text-caption text-muted-foreground">
              Loading chats…
            </p>
          ) : status === "error" && threads.length === 0 ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-caption text-muted-foreground">
                Chats could not be loaded.
              </span>
              <Button
                onClick={onRetryLoad}
                size="sm"
                type="button"
                variant="ghost"
              >
                Try again
              </Button>
            </div>
          ) : threads.length === 0 ? (
            <p className="px-2 py-1.5 text-caption text-muted-foreground">
              No chats yet.
            </p>
          ) : (
            <ul className="flex max-h-72 flex-col overflow-y-auto">
              {threads.map((thread) => {
                const isActive = thread.id === activeThreadId;
                const title = thread.title.trim() || "Chat";
                return (
                  <li className="flex items-center gap-1" key={thread.id}>
                    <button
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex min-w-0 flex-1 flex-col items-start rounded-sm px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted",
                        isActive && "bg-muted/70",
                      )}
                      onClick={() => {
                        onSelect(thread.id);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      <span className="w-full truncate text-label-sm">
                        {title}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {updatedLabel(thread.updatedAt)}
                      </span>
                    </button>
                    <Button
                      aria-label={`Delete chat: ${title}`}
                      className="size-7 shrink-0"
                      disabled={thread.id === lockedThreadId}
                      onClick={() => {
                        setOpen(false);
                        setPendingDelete(thread);
                      }}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>
      <StudioConfirmDialog
        confirmLabel="Delete chat"
        description="Its messages are deleted, and any proposed changes in this chat that are still waiting for review are discarded. Changes you already accepted stay."
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        open={pendingDelete !== null}
        title="Delete this chat?"
      />
    </>
  );
}
