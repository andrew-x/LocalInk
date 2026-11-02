"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  StudioChatDiscardResult,
  StudioChatMessageDto,
  StudioChatPreparedTurn,
  StudioChatSavedTurn,
  StudioChatStep,
} from "@/actions/studio/_types";
import { discardStudioChatTurn } from "@/actions/studio/discard-studio-chat-turn";
import { prepareStudioChatTurn } from "@/actions/studio/prepare-studio-chat-turn";
import { saveStudioChatTurn } from "@/actions/studio/save-studio-chat-turn";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
import {
  readRouteErrorMessage,
  StudioRequestError,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  readStudioChatStream,
  type StudioChatContext,
  type StudioChatRequest,
} from "@/lib/studio/chat-contract";

const SEND_FAILED = "The message could not be sent.";
const REPLY_FAILED =
  "The reply could not be finished. Your message is back in the composer.";
const SAVE_FAILED = "The reply could not be saved.";
const DISCARD_FAILED = "The unanswered message could not be removed.";
const UNSAVED_FIRST = "Save or discard the unsaved reply first.";

/**
 * - `idle`: no turn.
 * - `preparing`: the prepare action is storing the user message.
 * - `streaming`: the route is replying; Stop aborts.
 * - `saving`: the reply streamed completely; the save action persists it.
 * - `save-failed`: the draft stays on screen with Retry save / Discard.
 * - `stopping`: an aborted or failed turn is being discarded.
 */
export type ChatTurnStatus =
  | "idle"
  | "preparing"
  | "streaming"
  | "saving"
  | "save-failed"
  | "stopping";

/** The in-flight reply, shown after the saved messages of its thread. */
export type ChatTurnDraft = {
  threadId: string;
  generationId: string;
  userMessage: StudioChatMessageDto;
  text: string;
  steps: StudioChatStep[];
  /** The route sent its `bundle` event: proposed changes are being staged. */
  preparingChanges: boolean;
};

export type ChatDiscardOutcome = {
  threadId: string;
  userMessage: StudioChatMessageDto;
  /** Null when the discard failed: the stored message stays as an orphan. */
  result: StudioChatDiscardResult | null;
  /** The message to put back in the composer, or null to leave it. */
  restoreText: string | null;
};

export type ChatSendResult = { ok: true } | { ok: false; message: string };

type UseChatTurnOptions = {
  storyId: string;
  /** The user message is stored: clear the composer and adopt the thread. */
  onPrepared: (prepared: StudioChatPreparedTurn) => void;
  /** A reply was saved (a turn, a retry, or an orphan's late save). */
  onSaved: (saved: StudioChatSavedTurn) => void;
  /** A prepared turn was discarded, or its discard failed. */
  onDiscarded: (outcome: ChatDiscardOutcome) => void;
  /** A discard found the turn already answered; reload to reconcile. */
  onReloadThread: (threadId: string) => void;
};

type ChatTurnView = { status: ChatTurnStatus; draft: ChatTurnDraft | null };

type Turn = {
  controller: AbortController;
  /** The sent text (already trimmed by the composer schema). */
  content: string;
  prepared: StudioChatPreparedTurn | null;
  /** Resolves when the turn stops running; re-armed by retry and discard. */
  settled: Promise<void>;
  settle: () => void;
};

const IDLE: ChatTurnView = { status: "idle", draft: null };

function arm(turn: Turn) {
  turn.settled = new Promise<void>((resolve) => {
    turn.settle = resolve;
  });
}

function createTurn(content: string): Turn {
  const turn: Turn = {
    controller: new AbortController(),
    content,
    prepared: null,
    settled: Promise.resolve(),
    settle: () => {},
  };
  arm(turn);
  return turn;
}

/**
 * One agent chat turn at a time: prepare (stores the user message) → POST
 * /api/studio/chat → stream the reply → save. An aborted or failed stream
 * discards the prepared turn, so nothing of it persists, and hands the text
 * back to the composer. A failed save keeps the draft for Retry save (the
 * save is idempotent on generationId). Rendering stays out of this hook.
 */
export function useChatTurn(options: UseChatTurnOptions) {
  const { dispatch } = useStudioStore();
  const [view, setView] = useState<ChatTurnView>(IDLE);
  const [orphanBusy, setOrphanBusy] = useState<string | null>(null);
  const viewRef = useRef<ChatTurnView>(IDLE);
  const turnRef = useRef<Turn | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingTextRef = useRef("");
  // Turns (by generationId) whose text is back in the composer, or never
  // left it. A failed discard leaves the message as an orphan; its own
  // Discard must not put the same text back a second time.
  const restoredRef = useRef(new Set<string>());
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  const api = useMemo(() => {
    const commit = (next: ChatTurnView) => {
      viewRef.current = next;
      setView(next);
    };
    const isCurrent = (turn: Turn) => turnRef.current === turn;
    const updateDraft = (
      turn: Turn,
      update: (draft: ChatTurnDraft) => ChatTurnDraft,
    ) => {
      const current = viewRef.current;
      if (!isCurrent(turn) || !current.draft) return;
      commit({ ...current, draft: update(current.draft) });
    };
    const setStatus = (turn: Turn, status: ChatTurnStatus) => {
      if (isCurrent(turn)) commit({ ...viewRef.current, status });
    };
    const cancelFrame = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
    // Deltas land once per frame so the list does not re-render per token.
    const scheduleText = (turn: Turn, text: string) => {
      pendingTextRef.current = text;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const latest = pendingTextRef.current;
        updateDraft(turn, (draft) => ({ ...draft, text: latest }));
      });
    };
    /** The turn stops owning the view; a newer send may go ahead. */
    const release = (turn: Turn) => {
      if (isCurrent(turn)) {
        cancelFrame();
        turnRef.current = null;
        commit(IDLE);
      }
      turn.settle();
    };

    /** Saves a staged reply. Toasts and resolves null on failure. */
    const persist = async (
      threadId: string,
      generationId: string,
    ): Promise<StudioChatSavedTurn | null> => {
      let saved: StudioChatSavedTurn | undefined;
      try {
        const result = await saveStudioChatTurn({
          storyId: optionsRef.current.storyId,
          threadId,
          generationId,
        });
        saved = result?.data;
        if (!saved) toast.error(actionFailureMessage(result, SAVE_FAILED));
      } catch {
        toast.error(SAVE_FAILED);
      }
      if (!saved) return null;
      // Drives the in-place suggestions and the AI box's suggestion bar.
      if (saved.bundle) dispatch({ type: "merge", bundles: [saved.bundle] });
      optionsRef.current.onSaved(saved);
      return saved;
    };

    const requestDiscard = async (
      threadId: string,
      generationId: string,
    ): Promise<StudioChatDiscardResult | null> => {
      try {
        const result = await discardStudioChatTurn({
          storyId: optionsRef.current.storyId,
          threadId,
          generationId,
        });
        if (result?.data) return result.data;
        toast.error(actionFailureMessage(result, DISCARD_FAILED));
      } catch {
        toast.error(DISCARD_FAILED);
      }
      return null;
    };

    /** Aborted or failed stream: nothing of the turn may persist. */
    const discardTurn = async (
      turn: Turn,
      prepared: StudioChatPreparedTurn,
      restore: boolean,
    ) => {
      setStatus(turn, "stopping");
      const result = await requestDiscard(
        prepared.thread.id,
        prepared.generationId,
      );
      release(turn);
      const restoreText =
        restore && !restoredRef.current.has(prepared.generationId)
          ? turn.content
          : null;
      restoredRef.current.add(prepared.generationId);
      optionsRef.current.onDiscarded({
        threadId: prepared.thread.id,
        userMessage: prepared.userMessage,
        result,
        restoreText,
      });
    };

    const saveTurn = async (turn: Turn, prepared: StudioChatPreparedTurn) => {
      setStatus(turn, "saving");
      const saved = await persist(prepared.thread.id, prepared.generationId);
      if (saved) {
        release(turn);
        return;
      }
      setStatus(turn, "save-failed");
      turn.settle();
    };

    const streamAndSave = async (
      turn: Turn,
      prepared: StudioChatPreparedTurn,
      context: StudioChatContext,
    ) => {
      const { signal } = turn.controller;
      let text = "";
      commit({
        status: "streaming",
        draft: {
          threadId: prepared.thread.id,
          generationId: prepared.generationId,
          userMessage: prepared.userMessage,
          text: "",
          steps: [],
          preparingChanges: false,
        },
      });
      try {
        const response = await fetch("/api/studio/chat", {
          body: JSON.stringify({
            storyId: optionsRef.current.storyId,
            threadId: prepared.thread.id,
            generationId: prepared.generationId,
            context,
          } satisfies StudioChatRequest),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal,
        });
        if (!response.ok) {
          throw new StudioRequestError(await readRouteErrorMessage(response));
        }
        await readStudioChatStream(response, {
          incompleteMessage: "The reply stopped before it finished.",
          unavailableMessage: "The reply could not be started.",
          onDelta: (delta) => {
            text += delta;
            scheduleText(turn, text);
          },
          onStep: (step) =>
            updateDraft(turn, (draft) => ({
              ...draft,
              steps: [...draft.steps, step],
            })),
          onBundle: () =>
            updateDraft(turn, (draft) => ({
              ...draft,
              preparingChanges: true,
            })),
        });
        // Stop pressed as the stream completed still counts as a stop.
        if (signal.aborted) throw new StudioRequestError(REPLY_FAILED);
      } catch (error) {
        cancelFrame();
        // A stop (Stop, thread switch, new send, unmount) is silent.
        if (!signal.aborted) {
          toast.error(studioErrorMessage(error, REPLY_FAILED));
        }
        await discardTurn(turn, prepared, true);
        return;
      }
      cancelFrame();
      updateDraft(turn, (draft) => ({ ...draft, text }));
      await saveTurn(turn, prepared);
    };

    const send = async (
      content: string,
      threadId: string | null,
      context: StudioChatContext,
    ): Promise<ChatSendResult> => {
      const previous = turnRef.current;
      if (previous && viewRef.current.status !== "save-failed") {
        // A new send aborts the running turn and waits for it to settle.
        previous.controller.abort();
        await previous.settled;
      }
      // Sending now would make the unsaved reply's save conflict.
      if (turnRef.current && viewRef.current.status === "save-failed") {
        return { ok: false, message: UNSAVED_FIRST };
      }
      const turn = createTurn(content);
      turnRef.current = turn;
      commit({ status: "preparing", draft: null });

      let result: Awaited<ReturnType<typeof prepareStudioChatTurn>>;
      try {
        result = await prepareStudioChatTurn({
          storyId: optionsRef.current.storyId,
          threadId,
          content,
        });
      } catch {
        release(turn);
        return { ok: false, message: SEND_FAILED };
      }
      const prepared = result?.data;
      if (!prepared) {
        release(turn);
        return {
          ok: false,
          message: actionFailureMessage(result, SEND_FAILED),
        };
      }
      // Sending dismissed the suggestions still waiting (even if this turn
      // is stopped next); their in-place previews go away.
      if (prepared.rejectedBundles.length > 0) {
        dispatch({ type: "merge", bundles: prepared.rejectedBundles });
      }
      if (turn.controller.signal.aborted) {
        // Stopped while preparing: the composer still holds the text, so
        // only the stored message has to go.
        void discardTurn(turn, prepared, false);
        return { ok: true };
      }
      turn.prepared = prepared;
      optionsRef.current.onPrepared(prepared);
      void streamAndSave(turn, prepared, context);
      return { ok: true };
    };

    /** The author's Stop: silent abort while preparing or streaming. */
    const stop = () => {
      const status = viewRef.current.status;
      if (status === "preparing" || status === "streaming") {
        turnRef.current?.controller.abort();
      }
    };

    /**
     * Leaving the turn's thread (switch, new chat, delete). A running stream
     * is aborted and discarded. A save in flight finishes on its own (its
     * bundle still merges); an unsaved reply is dropped from view and shows
     * as an unanswered message with Retry save when its thread reopens.
     */
    const cancel = () => {
      const turn = turnRef.current;
      if (!turn) return;
      const status = viewRef.current.status;
      if (status === "preparing" || status === "streaming") {
        turn.controller.abort();
      } else if (status === "saving" || status === "save-failed") {
        release(turn);
      }
    };

    const retrySave = async () => {
      const turn = turnRef.current;
      const prepared = turn?.prepared;
      if (!turn || !prepared || viewRef.current.status !== "save-failed") {
        return;
      }
      arm(turn);
      await saveTurn(turn, prepared);
    };

    /** Gives up on an unsaved reply; the message goes back to the composer. */
    const discardUnsaved = async () => {
      const turn = turnRef.current;
      const prepared = turn?.prepared;
      if (!turn || !prepared || viewRef.current.status !== "save-failed") {
        return;
      }
      arm(turn);
      setStatus(turn, "stopping");
      const result = await requestDiscard(
        prepared.thread.id,
        prepared.generationId,
      );
      if (!result) {
        setStatus(turn, "save-failed");
        turn.settle();
        return;
      }
      release(turn);
      if (!result.discarded && !result.threadDeleted) {
        // Already answered (a save whose response was lost) or already gone.
        optionsRef.current.onReloadThread(prepared.thread.id);
        return;
      }
      const restoreText = restoredRef.current.has(prepared.generationId)
        ? null
        : turn.content;
      restoredRef.current.add(prepared.generationId);
      optionsRef.current.onDiscarded({
        threadId: prepared.thread.id,
        userMessage: prepared.userMessage,
        result,
        restoreText,
      });
    };

    /** A stored user message with no reply: try to save a staged reply. */
    const saveOrphan = async (message: StudioChatMessageDto) => {
      setOrphanBusy(message.generationId);
      try {
        await persist(message.threadId, message.generationId);
      } finally {
        setOrphanBusy(null);
      }
    };

    /** Removes an unanswered message; its text goes back to the composer. */
    const discardOrphan = async (message: StudioChatMessageDto) => {
      setOrphanBusy(message.generationId);
      try {
        const result = await requestDiscard(
          message.threadId,
          message.generationId,
        );
        if (!result) return;
        if (!result.discarded && !result.threadDeleted) {
          optionsRef.current.onReloadThread(message.threadId);
          return;
        }
        const restoreText = restoredRef.current.has(message.generationId)
          ? null
          : message.content;
        restoredRef.current.add(message.generationId);
        optionsRef.current.onDiscarded({
          threadId: message.threadId,
          userMessage: message,
          result,
          restoreText,
        });
      } finally {
        setOrphanBusy(null);
      }
    };

    const unmount = () => {
      cancelFrame();
      turnRef.current?.controller.abort();
    };

    const getStatus = () => viewRef.current.status;

    return {
      cancel,
      discardOrphan,
      discardUnsaved,
      getStatus,
      retrySave,
      saveOrphan,
      send,
      stop,
      unmount,
    };
  }, [dispatch]);

  // Leaving the workspace aborts a running turn; its discard still runs.
  useEffect(() => api.unmount, [api]);

  return {
    status: view.status,
    draft: view.draft,
    /** The generationId of the unanswered message being saved or removed. */
    orphanBusy,
    send: api.send,
    stop: api.stop,
    cancel: api.cancel,
    retrySave: api.retrySave,
    discardUnsaved: api.discardUnsaved,
    saveOrphan: api.saveOrphan,
    discardOrphan: api.discardOrphan,
    getStatus: api.getStatus,
  };
}

export type ChatTurnController = ReturnType<typeof useChatTurn>;
