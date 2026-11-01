"use client";

import { Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  type StudioChatComposerFormValues,
  studioChatComposerFormSchema,
} from "@/actions/studio/_schemas";
import type {
  StudioBundleDto,
  StudioChatMessageDto,
  StudioChatThreadDto,
} from "@/actions/studio/_types";
import { deleteStudioChatThread } from "@/actions/studio/delete-studio-chat-thread";
import { getStudioChatThread } from "@/actions/studio/get-studio-chat-thread";
import { getStudioChatThreads } from "@/actions/studio/get-studio-chat-threads";
import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { Button } from "@/components/common/button";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { formResolver } from "@/lib/schemas/resolve";
import {
  STORY_GENERATION_MODELS,
  storyGenerationModelSchema,
} from "@/lib/story-generation-models";
import { STUDIO_CHAT_MAX_PINNED_ENTRIES } from "@/lib/studio/chat-contract";

import { ChatComposer } from "./chat-composer";
import { ChatContextChips } from "./chat-context-chips";
import { ChatMessageList } from "./chat-message-list";
import { ChatQuickActions } from "./chat-quick-actions";
import { ChatThreadPicker, type ChatThreadsStatus } from "./chat-thread-picker";
import {
  type ChatDiscardOutcome,
  type ChatTurnStatus,
  useChatTurn,
} from "./use-chat-turn";

function upsertThreads(
  current: StudioChatThreadDto[],
  incoming: StudioChatThreadDto[],
): StudioChatThreadDto[] {
  const byId = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    const existing = byId.get(thread.id);
    if (!existing || thread.updatedAt >= existing.updatedAt) {
      byId.set(thread.id, thread);
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}

function upsertMessages(
  current: StudioChatMessageDto[],
  incoming: StudioChatMessageDto[],
): StudioChatMessageDto[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.position - b.position);
}

const ANNOUNCEMENT: Record<ChatTurnStatus, string> = {
  idle: "",
  preparing: "Sending your message.",
  streaming: "The assistant is replying.",
  saving: "Saving the reply.",
  "save-failed": "The reply was not saved.",
  stopping: "Stopping the reply.",
};

const MODEL_SELECT_CLASS =
  "h-7 max-w-32 min-w-0 shrink rounded-md border border-input bg-card/80 px-1.5 text-caption shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50";

/**
 * The agent chat tab. Chat state (threads, the open thread's messages, the
 * running turn) is local to this panel rather than the workspace store:
 * streamed text would otherwise re-render the whole workspace. The panel
 * stays mounted while Inspect shows, so a running turn and review-card
 * selections survive tab switches. Only bundles go to the store, where
 * they drive the in-place previews.
 */
export function ChatPanel({ active }: { active: boolean }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const modelSelectId = useId();

  const [threads, setThreads] = useState<StudioChatThreadDto[]>([]);
  const [threadsStatus, setThreadsStatus] = useState<ChatThreadsStatus>("idle");
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<StudioChatMessageDto[]>([]);
  // This thread's bundles as last seen. The store may drop resolved ones on
  // a workspace reload; these keep their cards rendering.
  const [threadBundles, setThreadBundles] = useState<StudioBundleDto[]>([]);
  const [threadLoad, setThreadLoad] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [pinnedEntryIds, setPinnedEntryIds] = useState<string[]>([]);
  const [dismissedLookingAt, setDismissedLookingAt] = useState<string | null>(
    null,
  );
  const [isSavingModel, setIsSavingModel] = useState(false);
  const activeThreadRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerHadFocusRef = useRef(false);
  const focusPendingRef = useRef(false);
  const handledFocusNonceRef = useRef(0);
  const threadsRequestedRef = useRef(false);

  // Route-form exception: the turn continues past the prepare action into
  // the streaming route and the save action, so this is plain useForm with
  // the composer schema rather than useHookFormAction.
  const form = useForm<StudioChatComposerFormValues>({
    defaultValues: { content: "" },
    resolver: formResolver(studioChatComposerFormSchema),
  });
  const { clearErrors, getValues, handleSubmit, reset, setError, setValue } =
    form;

  const setActiveThread = useCallback((threadId: string | null) => {
    activeThreadRef.current = threadId;
    setActiveThreadIdState(threadId);
  }, []);

  const clearThreadView = useCallback(() => {
    loadTokenRef.current += 1;
    setMessages([]);
    setThreadBundles([]);
    setThreadLoad("idle");
  }, []);

  const restoreComposer = useCallback(
    (text: string) => {
      const current = getValues("content");
      setValue(
        "content",
        current.trim() ? `${current.trimEnd()}\n\n${text}` : text,
        { shouldDirty: true },
      );
      clearErrors();
    },
    [clearErrors, getValues, setValue],
  );

  const loadThread = useCallback(
    async (threadId: string) => {
      loadTokenRef.current += 1;
      const token = loadTokenRef.current;
      setThreadLoad("loading");
      try {
        const detail = await getStudioChatThread({ storyId, threadId });
        if (token !== loadTokenRef.current) return;
        if (!detail) {
          toast.error("This chat no longer exists.");
          setThreads((current) => current.filter((t) => t.id !== threadId));
          if (activeThreadRef.current === threadId) setActiveThread(null);
          clearThreadView();
          return;
        }
        setMessages(detail.messages);
        setThreadBundles(detail.bundles);
        setThreads((current) => upsertThreads(current, [detail.thread]));
        setThreadLoad("idle");
        // Pending bundles drive previews and accepted ones keep Undo
        // reachable; the store keeps whichever copy is newer.
        if (detail.bundles.length > 0) {
          dispatch({ type: "merge", bundles: detail.bundles });
        }
      } catch {
        if (token !== loadTokenRef.current) return;
        setThreadLoad("error");
        toast.error("The chat could not be loaded.");
      }
    },
    [clearThreadView, dispatch, setActiveThread, storyId],
  );

  function handleDiscarded({
    threadId,
    userMessage,
    result,
    restoreText,
  }: ChatDiscardOutcome) {
    if (restoreText) restoreComposer(restoreText);
    if (result?.threadDeleted) {
      setThreads((current) => current.filter((t) => t.id !== threadId));
      if (activeThreadRef.current === threadId) {
        setActiveThread(null);
        clearThreadView();
      }
      return;
    }
    if (activeThreadRef.current !== threadId) return;
    setMessages((current) =>
      result
        ? current.filter((message) => message.id !== userMessage.id)
        : // The discard failed: the stored message stays, unanswered.
          upsertMessages(current, [userMessage]),
    );
  }

  const turn = useChatTurn({
    storyId,
    onPrepared: (prepared) => {
      reset({ content: "" });
      setDismissedLookingAt(null);
      setThreads((current) => upsertThreads(current, [prepared.thread]));
      if (activeThreadRef.current !== prepared.thread.id) {
        // A new chat got its thread. (Switching threads aborts the turn, so
        // this only ever adopts a thread created by this send.)
        setActiveThread(prepared.thread.id);
        clearThreadView();
      }
    },
    onSaved: (saved) => {
      setThreads((current) => upsertThreads(current, [saved.thread]));
      if (activeThreadRef.current !== saved.thread.id) return;
      setMessages((current) => upsertMessages(current, saved.messages));
      const { bundle } = saved;
      if (bundle) {
        setThreadBundles((current) => [
          ...current.filter((b) => b.id !== bundle.id),
          bundle,
        ]);
      }
    },
    onDiscarded: handleDiscarded,
    onReloadThread: (threadId) => {
      if (activeThreadRef.current === threadId) void loadThread(threadId);
    },
  });
  const { cancel: cancelTurn, getStatus: getTurnStatus } = turn;

  /** The author opens a thread (or a new chat): a running turn is aborted. */
  const openThread = useCallback(
    (threadId: string | null) => {
      if (threadId === activeThreadRef.current) return;
      cancelTurn();
      setActiveThread(threadId);
      clearThreadView();
      setDismissedLookingAt(null);
      if (threadId) void loadThread(threadId);
    },
    [cancelTurn, clearThreadView, loadThread, setActiveThread],
  );

  const loadThreads = useCallback(
    async (openLatest: boolean) => {
      setThreadsStatus("loading");
      try {
        const list = await getStudioChatThreads({ storyId });
        setThreads((current) => upsertThreads(current, list));
        setThreadsStatus("ready");
        const latest = list[0];
        if (
          openLatest &&
          latest &&
          activeThreadRef.current === null &&
          getTurnStatus() === "idle" &&
          !focusPendingRef.current
        ) {
          openThread(latest.id);
        }
      } catch {
        setThreadsStatus("error");
        toast.error("Your chats could not be loaded.");
      }
    },
    [getTurnStatus, openThread, storyId],
  );

  // Threads load the first time the tab shows, opening the latest one.
  useEffect(() => {
    if (!active || threadsRequestedRef.current) return;
    threadsRequestedRef.current = true;
    void loadThreads(true);
  }, [active, loadThreads]);

  // Keep this thread's bundle copies as new as the store's.
  useEffect(() => {
    setThreadBundles((current) => {
      if (current.length === 0) return current;
      const inStore = new Map(state.bundles.map((b) => [b.id, b]));
      let changed = false;
      const next = current.map((bundle) => {
        const stored = inStore.get(bundle.id);
        if (stored && stored.updatedAt > bundle.updatedAt) {
          changed = true;
          return stored;
        }
        return bundle;
      });
      return changed ? next : current;
    });
  }, [state.bundles]);

  const bundleById = useMemo(() => {
    const byId = new Map(threadBundles.map((b) => [b.id, b]));
    for (const bundle of state.bundles) {
      const copy = byId.get(bundle.id);
      if (!copy || bundle.updatedAt >= copy.updatedAt)
        byId.set(bundle.id, bundle);
    }
    return byId;
  }, [state.bundles, threadBundles]);

  // A focused op in another thread's bundle opens that thread so its card
  // mounts; the card itself scrolls, highlights, and clears the focus. The
  // switch happens now or never: a tree click must not abort a running turn,
  // and jumping threads when that turn settles, long after the click, would
  // be disorienting. A save-failed reply stays recoverable from its thread.
  const focusedBundleId = state.focusedBundleOp?.bundleId ?? null;
  const focusThreadId = useMemo(() => {
    if (!focusedBundleId) return null;
    const owner =
      state.bundles.find((bundle) => bundle.id === focusedBundleId) ??
      threadBundles.find((bundle) => bundle.id === focusedBundleId);
    return owner?.threadId ?? null;
  }, [focusedBundleId, state.bundles, threadBundles]);
  useEffect(() => {
    focusPendingRef.current = focusThreadId !== null;
    if (!focusThreadId || focusThreadId === activeThreadId) return;
    if (handledFocusNonceRef.current === state.bundleFocusNonce) return;
    handledFocusNonceRef.current = state.bundleFocusNonce;
    const status = getTurnStatus();
    if (status !== "idle" && status !== "save-failed") {
      toast.info(
        "Those changes are in another chat. Try again once this reply finishes.",
      );
      return;
    }
    openThread(focusThreadId);
  }, [
    activeThreadId,
    focusThreadId,
    getTurnStatus,
    openThread,
    state.bundleFocusNonce,
  ]);

  // Give the composer its focus back once a turn sent from it settles.
  useEffect(() => {
    if (turn.status !== "idle" || !composerHadFocusRef.current) return;
    composerHadFocusRef.current = false;
    const focused = document.activeElement;
    if (active && (!focused || focused === document.body)) {
      textareaRef.current?.focus();
    }
  }, [active, turn.status]);

  async function deleteThread(threadId: string): Promise<boolean> {
    const result = await run(
      deleteStudioChatThread({ storyId, threadId }),
      "The chat could not be deleted.",
    );
    if (!result) return false;
    // Its pending proposals are now rejected; their previews go away.
    if (result.rejectedBundles.length > 0) {
      dispatch({ type: "merge", bundles: result.rejectedBundles });
    }
    setThreads((current) => current.filter((t) => t.id !== threadId));
    if (activeThreadRef.current === threadId) openThread(null);
    return true;
  }

  async function changeChatModel(value: string) {
    const parsed = storyGenerationModelSchema.safeParse(value);
    if (!parsed.success || parsed.data === state.story.chatModel) return;
    setIsSavingModel(true);
    try {
      const updated = await run(
        updateStudioStory({ storyId, patch: { chatModel: parsed.data } }),
        "The chat model could not be saved.",
      );
      if (updated) dispatch({ type: "merge", story: updated });
    } finally {
      setIsSavingModel(false);
    }
  }

  const selectedId = state.selectedItemId;
  const lookingAtItemId =
    selectedId &&
    selectedId !== dismissedLookingAt &&
    state.planItems.some((item) => item.id === selectedId)
      ? selectedId
      : null;
  const validPinnedIds = useMemo(() => {
    const ids = new Set(state.entries.map((entry) => entry.id));
    return pinnedEntryIds.filter((id) => ids.has(id));
  }, [pinnedEntryIds, state.entries]);

  const onSubmit = handleSubmit(async ({ content }) => {
    composerHadFocusRef.current =
      document.activeElement === textareaRef.current;
    const result = await turn.send(content, activeThreadRef.current, {
      lookingAtItemId,
      pinnedEntryIds: validPinnedIds.slice(0, STUDIO_CHAT_MAX_PINNED_ENTRIES),
    });
    if (!result.ok) {
      setError("root.serverError", { message: result.message });
      toast.error(result.message);
    }
  });

  function insertPrompt(prompt: string) {
    const current = getValues("content");
    const next = current.trim() ? `${current.trimEnd()}\n${prompt}` : prompt;
    setValue("content", next, { shouldDirty: true });
    clearErrors();
    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element || element.disabled) return;
      element.focus();
      element.setSelectionRange(next.length, next.length);
    });
  }

  const draft =
    turn.draft && turn.draft.threadId === activeThreadId ? turn.draft : null;
  const turnRunning = turn.status !== "idle" && turn.status !== "save-failed";
  const lockedThreadId = turnRunning
    ? (turn.draft?.threadId ?? activeThreadId)
    : null;
  const blockedReason =
    threadLoad === "loading"
      ? "Loading chat…"
      : turn.status === "save-failed"
        ? "Save or discard the reply above first."
        : null;
  const hasMessages = messages.length > 0 || draft !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 items-center gap-1 border-border/60 border-b px-2">
        <ChatThreadPicker
          activeThreadId={activeThreadId}
          lockedThreadId={lockedThreadId}
          onDelete={deleteThread}
          onNew={() => openThread(null)}
          onRetryLoad={() => void loadThreads(false)}
          onSelect={(threadId) => openThread(threadId)}
          status={threadsStatus}
          threads={threads}
        />
        <Button
          aria-label="New chat"
          className="size-7 shrink-0"
          disabled={activeThreadId === null}
          onClick={() => openThread(null)}
          size="icon"
          tooltip="New chat"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
        <label className="sr-only" htmlFor={modelSelectId}>
          Chat model
        </label>
        <select
          className={MODEL_SELECT_CLASS}
          disabled={isSavingModel}
          id={modelSelectId}
          onChange={(event) => void changeChatModel(event.target.value)}
          title="Chat model"
          value={state.story.chatModel}
        >
          {STORY_GENERATION_MODELS.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </div>

      <ChatMessageList
        active={active}
        bundleById={bundleById}
        draft={draft}
        empty={
          <div className="flex flex-col gap-3">
            <p className="text-caption text-muted-foreground">
              Brainstorm, ask about the story, or ask for changes. Talking
              changes nothing: anything the assistant proposes comes back here
              for you to review first.
            </p>
            <ChatQuickActions
              disabled={turnRunning || blockedReason !== null}
              layout="list"
              onInsert={insertPrompt}
              pinnedEntryIds={validPinnedIds}
            />
          </div>
        }
        loadFailed={threadLoad === "error"}
        loading={threadLoad === "loading"}
        messages={messages}
        onDiscardOrphan={(message) => void turn.discardOrphan(message)}
        onDiscardUnsaved={() => void turn.discardUnsaved()}
        onRetryLoad={() => {
          if (activeThreadRef.current) void loadThread(activeThreadRef.current);
        }}
        onRetrySave={() => void turn.retrySave()}
        onSaveOrphan={(message) => void turn.saveOrphan(message)}
        orphanBusy={turn.orphanBusy}
        status={turn.status}
        threadId={activeThreadId}
      />

      <div className="flex shrink-0 flex-col gap-2 border-border/60 border-t p-3">
        <div className="flex flex-wrap items-center gap-1">
          {hasMessages ? (
            <ChatQuickActions
              disabled={turnRunning || blockedReason !== null}
              layout="menu"
              onInsert={insertPrompt}
              pinnedEntryIds={validPinnedIds}
            />
          ) : null}
          <ChatContextChips
            lookingAtItemId={lookingAtItemId}
            onDismissLookingAt={() => setDismissedLookingAt(selectedId)}
            onPin={(entryId) =>
              setPinnedEntryIds((current) =>
                current.includes(entryId) ? current : [...current, entryId],
              )
            }
            onUnpin={(entryId) =>
              setPinnedEntryIds((current) =>
                current.filter((id) => id !== entryId),
              )
            }
            pinnedEntryIds={validPinnedIds}
          />
        </div>
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
