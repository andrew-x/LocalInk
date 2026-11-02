"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type UseFormReturn, useForm } from "react-hook-form";
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
import type { ChatThreadsStatus } from "@/components/studio/chat/chat-thread-picker";
import {
  type ChatDiscardOutcome,
  type ChatSendResult,
  type ChatTurnController,
  type ChatTurnDraft,
  useChatTurn,
} from "@/components/studio/chat/use-chat-turn";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { formResolver } from "@/lib/schemas/resolve";

const TURN_BUSY = "Wait for the AI to finish replying.";
const UNSAVED_REPLY = "Save or discard the unsaved reply first.";

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

/** An op row the conversation panel should scroll to and ring once. */
export type ChatOpHighlight = { bundleId: string; opId: string; nonce: number };

export type ChatSession = {
  threads: StudioChatThreadDto[];
  threadsStatus: ChatThreadsStatus;
  activeThreadId: string | null;
  /** A thread whose turn is running; it cannot be deleted until it settles. */
  lockedThreadId: string | null;
  /** Opens a thread (null: a new conversation); a running turn is aborted. */
  openThread: (threadId: string | null) => void;
  deleteThread: (threadId: string) => Promise<boolean>;
  retryLoadThreads: () => void;
  messages: StudioChatMessageDto[];
  /** The running turn's draft, when it belongs to the open thread. */
  draft: ChatTurnDraft | null;
  threadLoad: "idle" | "loading" | "error";
  retryLoadThread: () => void;
  /** The open thread's bundles, as new as the store's copies. */
  bundleById: Map<string, StudioBundleDto>;
  turn: ChatTurnController;
  /** Preparing, streaming, saving, or stopping. */
  turnRunning: boolean;
  /** Why sending is blocked besides a running turn, if it is. */
  blockedReason: string | null;
  form: UseFormReturn<StudioChatComposerFormValues>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: ReturnType<
    UseFormReturn<StudioChatComposerFormValues>["handleSubmit"]
  >;
  /** Puts a prompt in the composer (a suggestion chip). */
  insertPrompt: (prompt: string) => void;
  /** The outline item the next message mentions, or null. */
  lookingAtItemId: string | null;
  /** Leaves the current outline item out of the next message. */
  dismissLookingAt: () => void;
  conversationOpen: boolean;
  setConversationOpen: (open: boolean) => void;
  highlight: ChatOpHighlight | null;
  /** Opens the conversation and rings the op's row once it renders. */
  showOpInConversation: (bundleId: string, opId: string) => void;
  clearHighlight: (nonce: number) => void;
};

/** Sends a message without touching the composer (a draft's Try again). */
export type ChatSend = (content: string) => Promise<ChatSendResult>;

const ChatSessionContext = createContext<ChatSession | null>(null);
const ChatSendContext = createContext<ChatSend | null>(null);

/**
 * The story's AI conversation: threads, the open thread's messages and
 * bundles, the running turn, and the composer. It lives in its own provider
 * rather than the workspace store, because streamed tokens would otherwise
 * re-render the plan, the editors, and the manuscript; only bundles go to
 * the store, where they drive the in-place suggestions. Mounted for the
 * workspace's lifetime, so hiding the plan never aborts a running turn.
 */
export function ChatSessionProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const loop = useWritingLoop();
  const storyId = state.story.id;
  const planVisible = !state.readMode;

  const [threads, setThreads] = useState<StudioChatThreadDto[]>([]);
  const [threadsStatus, setThreadsStatus] = useState<ChatThreadsStatus>("idle");
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<StudioChatMessageDto[]>([]);
  // This thread's bundles as last seen. The store may drop resolved ones on
  // a workspace reload; these keep their op lists rendering.
  const [threadBundles, setThreadBundles] = useState<StudioBundleDto[]>([]);
  const [threadLoad, setThreadLoad] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [dismissedLookingAt, setDismissedLookingAt] = useState<string | null>(
    null,
  );
  const [conversationOpen, setConversationOpen] = useState(false);
  const [highlight, setHighlight] = useState<ChatOpHighlight | null>(null);
  const highlightNonceRef = useRef(0);
  const activeThreadRef = useRef<string | null>(null);
  const loadTokenRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerHadFocusRef = useRef(false);
  // Whether the send in flight came from the composer; only that one clears it.
  const fromComposerRef = useRef(false);
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
          toast.error("This conversation no longer exists.");
          setThreads((current) => current.filter((t) => t.id !== threadId));
          if (activeThreadRef.current === threadId) setActiveThread(null);
          clearThreadView();
          return;
        }
        setMessages(detail.messages);
        setThreadBundles(detail.bundles);
        setThreads((current) => upsertThreads(current, [detail.thread]));
        setThreadLoad("idle");
        // Pending bundles drive the in-place suggestions and accepted ones
        // keep Undo reachable; the store keeps whichever copy is newer.
        if (detail.bundles.length > 0) {
          dispatch({ type: "merge", bundles: detail.bundles });
        }
      } catch {
        if (token !== loadTokenRef.current) return;
        setThreadLoad("error");
        toast.error("The conversation could not be loaded.");
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

  // useChatTurn merges `rejectedBundles` (the suggestions a new message
  // dismissed) and each saved reply's bundle into the store.
  const turn = useChatTurn({
    storyId,
    onPrepared: (prepared) => {
      if (fromComposerRef.current) reset({ content: "" });
      fromComposerRef.current = false;
      setDismissedLookingAt(null);
      setThreads((current) => upsertThreads(current, [prepared.thread]));
      if (activeThreadRef.current !== prepared.thread.id) {
        // A new conversation got its thread. (Switching threads aborts the
        // turn, so this only ever adopts a thread created by this send.)
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
        // One running conversation per story: the latest one opens.
        if (
          openLatest &&
          latest &&
          activeThreadRef.current === null &&
          getTurnStatus() === "idle"
        ) {
          openThread(latest.id);
        }
      } catch {
        setThreadsStatus("error");
        toast.error("Your conversations could not be loaded.");
      }
    },
    [getTurnStatus, openThread, storyId],
  );

  useEffect(() => {
    if (threadsRequestedRef.current) return;
    threadsRequestedRef.current = true;
    void loadThreads(true);
  }, [loadThreads]);

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
      if (!copy || bundle.updatedAt >= copy.updatedAt) {
        byId.set(bundle.id, bundle);
      }
    }
    return byId;
  }, [state.bundles, threadBundles]);

  // Give the composer its focus back once a turn sent from it settles.
  useEffect(() => {
    if (turn.status !== "idle" || !composerHadFocusRef.current) return;
    composerHadFocusRef.current = false;
    const focused = document.activeElement;
    if (planVisible && (!focused || focused === document.body)) {
      textareaRef.current?.focus();
    }
  }, [planVisible, turn.status]);

  const deleteThread = useCallback(
    async (threadId: string): Promise<boolean> => {
      const result = await run(
        deleteStudioChatThread({ storyId, threadId }),
        "The conversation could not be deleted.",
      );
      if (!result) return false;
      // Its pending suggestions are now dismissed; they leave the plan.
      if (result.rejectedBundles.length > 0) {
        dispatch({ type: "merge", bundles: result.rejectedBundles });
      }
      setThreads((current) => current.filter((t) => t.id !== threadId));
      if (activeThreadRef.current === threadId) openThread(null);
      return true;
    },
    [dispatch, openThread, run, storyId],
  );

  const selectedId = state.selectedItemId;
  const lookingAtItemId =
    selectedId &&
    selectedId !== dismissedLookingAt &&
    state.planItems.some((item) => item.id === selectedId)
      ? selectedId
      : null;
  const lookingAtRef = useRef(lookingAtItemId);
  useEffect(() => {
    lookingAtRef.current = lookingAtItemId;
  }, [lookingAtItemId]);

  const { confirmDiscardDraft } = loop;
  const { send: sendTurn } = turn;
  /** One draft at a time: an unkept writing-loop draft is discarded first. */
  const sendMessage = useCallback(
    async (
      content: string,
      fromComposer: boolean,
    ): Promise<ChatSendResult | null> => {
      if (!(await confirmDiscardDraft())) return null;
      fromComposerRef.current = fromComposer;
      const result = await sendTurn(content, activeThreadRef.current, {
        lookingAtItemId: lookingAtRef.current,
        pinnedEntryIds: [],
      });
      if (!result.ok) fromComposerRef.current = false;
      return result;
    },
    [confirmDiscardDraft, sendTurn],
  );

  const onSubmit = handleSubmit(async ({ content }) => {
    composerHadFocusRef.current =
      document.activeElement === textareaRef.current;
    const result = await sendMessage(content, true);
    if (result && !result.ok) {
      setError("root.serverError", { message: result.message });
      toast.error(result.message);
    }
  });

  const send = useCallback<ChatSend>(
    async (content) => {
      const status = getTurnStatus();
      if (status !== "idle") {
        const message = status === "save-failed" ? UNSAVED_REPLY : TURN_BUSY;
        toast.info(message);
        return { ok: false, message };
      }
      const result = await sendMessage(content, false);
      if (!result) return { ok: true };
      if (!result.ok) toast.error(result.message);
      return result;
    },
    [getTurnStatus, sendMessage],
  );

  const insertPrompt = useCallback(
    (prompt: string) => {
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
    },
    [clearErrors, getValues, setValue],
  );

  const showOpInConversation = useCallback((bundleId: string, opId: string) => {
    highlightNonceRef.current += 1;
    setConversationOpen(true);
    setHighlight({ bundleId, opId, nonce: highlightNonceRef.current });
  }, []);
  const clearHighlight = useCallback((nonce: number) => {
    setHighlight((current) => (current?.nonce === nonce ? null : current));
  }, []);

  const draft =
    turn.draft && turn.draft.threadId === activeThreadId ? turn.draft : null;
  const turnRunning = turn.status !== "idle" && turn.status !== "save-failed";
  const lockedThreadId = turnRunning
    ? (turn.draft?.threadId ?? activeThreadId)
    : null;
  const blockedReason =
    threadLoad === "loading"
      ? "Loading the conversation…"
      : turn.status === "save-failed"
        ? "Save or discard the unsaved reply first."
        : null;

  const retryLoadThreads = useCallback(
    () => void loadThreads(false),
    [loadThreads],
  );
  const retryLoadThread = useCallback(() => {
    if (activeThreadRef.current) void loadThread(activeThreadRef.current);
  }, [loadThread]);
  const dismissLookingAt = useCallback(
    () => setDismissedLookingAt(selectedId),
    [selectedId],
  );

  const session: ChatSession = {
    threads,
    threadsStatus,
    activeThreadId,
    lockedThreadId,
    openThread,
    deleteThread,
    retryLoadThreads,
    messages,
    draft,
    threadLoad,
    retryLoadThread,
    bundleById,
    turn,
    turnRunning,
    blockedReason,
    form,
    textareaRef,
    onSubmit,
    insertPrompt,
    lookingAtItemId,
    dismissLookingAt,
    conversationOpen,
    setConversationOpen,
    highlight,
    showOpInConversation,
    clearHighlight,
  };

  return createElement(
    ChatSendContext.Provider,
    { value: send },
    createElement(ChatSessionContext.Provider, { value: session }, children),
  );
}

/**
 * The full chat session, for the AI box and the conversation panel. It
 * changes with every streamed frame, so keep it out of heavy subtrees.
 */
export function useChatSession(): ChatSession {
  const value = useContext(ChatSessionContext);
  if (!value) {
    throw new Error("useChatSession must be used inside ChatSessionProvider.");
  }
  return value;
}

/**
 * The session's `send`, stable across streamed frames, for the manuscript's
 * chat draft (Try again). It asks before discarding a writing-loop draft and
 * refuses while a reply is running.
 */
export function useChatSend(): ChatSend {
  const value = useContext(ChatSendContext);
  if (!value) {
    throw new Error("useChatSend must be used inside ChatSessionProvider.");
  }
  return value;
}
