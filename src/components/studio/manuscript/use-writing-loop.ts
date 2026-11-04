"use client";

import {
  createContext,
  createElement,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { keepStudioSceneDraft } from "@/actions/studio/keep-studio-scene-draft";
import { getBundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import {
  isBundleDecisionRunning,
  useResolveBundle,
} from "@/components/studio/bundles/use-resolve-bundle";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioBundleDto } from "@/lib/studio/bundle-contract";

import { flushMomentEditor } from "./editor-registry";
import { readBackStudioMoment } from "./read-back-client";
import {
  dropDraftBeats,
  isSceneDraftKeepable,
  isSceneDraftRunning,
  orderedDraftBeats,
  orphanedDraftBeats,
  type SceneDraft,
  settleDraft,
} from "./scene-draft-model";
import { useChapterQueue, type WritingQueue } from "./use-chapter-queue";
import { useSceneDraftRunner } from "./use-scene-draft-runner";

export type { BeatDraft, SceneDraft } from "./scene-draft-model";
export type { WritingQueue } from "./use-chapter-queue";

const KEEP_FAILED = "The draft could not be kept. Please try again.";
const FLUSH_FAILED =
  "Your edits to this scene could not be saved, so the draft was not kept.";
const READ_BACK_FAILED =
  "Kept, but re-reading failed. Use Re-read in the scene menu.";
const KEEPING_WAIT = "Wait until the scene is kept.";
const DECISION_RUNNING =
  "A suggestion is still being applied. Try Write again in a moment.";
const DISCARDED = "Draft discarded.";
const RESTORE_BLOCKED =
  "Another draft is open, so the discarded one can't come back.";
const RESTORE_GONE =
  "The discarded draft's scene or beats are gone, so it can't come back.";

export type WritingLoop = {
  draft: SceneDraft | null;
  /** Write on a chapter: its scenes in order, each waiting for Keep. */
  queue: WritingQueue | null;
  /** Keep scene is saving the draft or re-reading the kept beats. */
  isKeeping: boolean;
  writeScene: (
    sceneId: string,
    opts?: { momentIds?: string[] },
  ) => Promise<void>;
  writeChapter: (chapterId: string) => Promise<void>;
  redoBeat: (momentId: string, note?: string) => Promise<void>;
  tryAgain: (note?: string) => Promise<void>;
  keepScene: () => Promise<void>;
  stop: () => void;
  /** Drops the draft; a toast offers Undo, which brings it back as it was. */
  discard: () => void;
  /**
   * One draft at a time, from the AI box's side: before a chat message is
   * sent, asks to discard an unkept draft. Resolves true when there is none
   * or it was discarded, false when the author cancelled (or a Keep is
   * still running), in which case nothing is sent.
   */
  confirmDiscardDraft: () => Promise<boolean>;
};

type KeepOutcome = "kept" | "unread" | "failed";

/** The chat's draft: its pending prose ops that show in the manuscript. */
function chatDraftOps(
  bundles: StudioBundleDto[],
): { bundleId: string; opIds: string[] } | null {
  const preview = getBundlePreview(bundles);
  const opIds = [...preview.proseOpsByMomentId.values()].map((op) => op.id);
  return preview.bundleId && opIds.length > 0
    ? { bundleId: preview.bundleId, opIds }
    : null;
}

/**
 * What the one-draft-at-a-time dialog asks about: starting a Write over the
 * loop's draft and/or the chat's suggested draft, or sending a chat message
 * over the loop's draft.
 */
type ConfirmRequest = {
  kind: "write" | "send";
  loopDraft: boolean;
  chatDraft: boolean;
};

function confirmCopy(request: ConfirmRequest) {
  if (request.kind === "send") {
    return {
      title: "Discard the current draft?",
      description:
        "Only one draft can be open at a time, and the AI may suggest a new one. The current draft hasn't been kept, so it will be thrown away.",
      confirmLabel: "Discard and send",
    };
  }
  if (request.loopDraft && request.chatDraft) {
    return {
      title: "Discard the current drafts?",
      description:
        "Only one draft can be open at a time. The draft that hasn't been kept is thrown away, and the draft the AI suggested is dismissed.",
      confirmLabel: "Discard and write",
    };
  }
  if (request.chatDraft) {
    return {
      title: "Dismiss the AI's draft?",
      description:
        "Only one draft can be open at a time, so the draft the AI suggested will be dismissed.",
      confirmLabel: "Dismiss and write",
    };
  }
  return {
    title: "Discard the current draft?",
    description:
      "Only one draft can be open at a time. The current draft hasn't been kept, so it will be thrown away.",
    confirmLabel: "Discard and write",
  };
}

const WritingLoopContext = createContext<WritingLoop | null>(null);
/**
 * `confirmDiscardDraft` alone, stable for the workspace's lifetime, so the AI
 * box's chat session can use it without re-rendering on every streamed frame
 * of the loop's draft.
 */
const ConfirmDiscardDraftContext = createContext<
  WritingLoop["confirmDiscardDraft"] | null
>(null);

/**
 * One writing loop per workspace, shared by the manuscript and the outline.
 * The author approves a scene at a time: Write drafts every target beat, Keep
 * scene persists all of the staged beats in one transaction (or none) and
 * then re-reads them in order. One draft at a time; starting another asks to
 * discard the current one.
 */
export function WritingLoopProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [isKeeping, setIsKeeping] = useState(false);
  const keepingRef = useRef(false);
  const {
    commitDraft,
    discard: discardDraft,
    draft,
    draftRef,
    dropBeats,
    redoBeat,
    startScene,
    stop: stopDraft,
    tryAgain,
  } = useSceneDraftRunner({ keepingRef, stateRef, storyId });

  const { endQueue, queue, runChapter, settleKept } = useChapterQueue({
    draftRef,
    keepingRef,
    startScene,
    stateRef,
  });

  const stop = useCallback(() => {
    endQueue();
    stopDraft();
  }, [endQueue, stopDraft]);

  const discard = useCallback(() => {
    if (keepingRef.current) return;
    endQueue();
    discardDraft();
  }, [discardDraft, endQueue]);

  // Staged beats live 6 hours, so an undone draft can usually still be kept;
  // if Keep finds a stage gone, the bar's Try again guidance applies.
  const restoreDraft = useCallback(
    (snapshot: SceneDraft) => {
      if (
        keepingRef.current ||
        draftRef.current ||
        chatDraftOps(stateRef.current.bundles)
      ) {
        toast.info(RESTORE_BLOCKED);
        return;
      }
      const orphaned = orphanedDraftBeats(snapshot, stateRef.current.planItems);
      if (orphaned === "scene" || orphaned.size === snapshot.beats.length) {
        toast.error(RESTORE_GONE);
        return;
      }
      const { draft: restored } = dropDraftBeats(snapshot, orphaned);
      commitDraft(settleDraft(restored, stateRef.current.planItems));
    },
    [commitDraft, draftRef],
  );

  /** The bar's Discard, with Undo. */
  const discardWithUndo = useCallback(() => {
    const current = draftRef.current;
    if (keepingRef.current || !current) return;
    discard();
    // Planning has nothing on screen to bring back.
    if (current.status === "planning") return;
    // Like Stop, a beat cut off mid-stream comes back unfinished.
    const snapshot: SceneDraft = isSceneDraftRunning(current)
      ? {
          ...current,
          status: "stopped",
          beats: current.beats.map((beat) =>
            beat.status === "streaming"
              ? { ...beat, status: "error", generationId: null }
              : beat,
          ),
        }
      : current;
    toast(DISCARDED, {
      action: { label: "Undo", onClick: () => restoreDraft(snapshot) },
      duration: 10_000,
    });
  }, [discard, draftRef, restoreDraft]);

  const keepAndReadBack = useCallback(
    async (current: SceneDraft): Promise<KeepOutcome> => {
      const beats = orderedDraftBeats(current, stateRef.current.planItems);
      const proseById = new Map(
        stateRef.current.prose.map((entry) => [entry.momentId, entry]),
      );
      // Land pending edits first so replaced text becomes a version. A beat
      // shown as a draft has no editor mounted, so its stored revision is used.
      const revisions = await Promise.all(
        beats.map((beat) =>
          flushMomentEditor(
            beat.momentId,
            proseById.get(beat.momentId)?.revision ?? 0,
          ),
        ),
      );
      const keepBeats = beats.flatMap((beat, index) => {
        const expectedRevision = revisions[index];
        return beat.generationId && expectedRevision !== null
          ? [
              {
                momentId: beat.momentId,
                generationId: beat.generationId,
                expectedRevision,
              },
            ]
          : [];
      });
      if (keepBeats.length !== beats.length) {
        toast.error(FLUSH_FAILED);
        return "failed";
      }
      // All or nothing on the server: a refusal (an expired beat, a stale
      // revision) writes nothing, so the draft stays on screen for a redo.
      const kept = await run(
        keepStudioSceneDraft({
          storyId,
          sceneId: current.sceneId,
          beats: keepBeats,
        }),
        KEEP_FAILED,
      );
      if (!kept) {
        const latest = draftRef.current;
        if (latest?.sceneId === current.sceneId) {
          commitDraft({ ...latest, keepRefused: true });
        }
        return "failed";
      }
      dispatch({ type: "merge", prose: kept });
      if (draftRef.current?.sceneId === current.sceneId) commitDraft(null);

      // In order, so each beat's confirmed changes land before the next one.
      for (const beat of beats) {
        try {
          const patch = await readBackStudioMoment({
            storyId,
            momentId: beat.momentId,
            force: true,
          });
          if (patch) dispatch({ type: "merge", ...patch });
        } catch {
          toast.error(READ_BACK_FAILED);
          return "unread";
        }
      }
      return "kept";
    },
    [commitDraft, dispatch, draftRef, run, storyId],
  );

  const keepScene = useCallback(async () => {
    const current = draftRef.current;
    if (keepingRef.current || !isSceneDraftKeepable(current) || !current) {
      return;
    }
    keepingRef.current = true;
    setIsKeeping(true);
    let outcome: KeepOutcome = "failed";
    try {
      outcome = await keepAndReadBack(current);
    } finally {
      keepingRef.current = false;
      setIsKeeping(false);
    }
    // A failed keep leaves a chapter queue waiting on the same draft.
    if (outcome !== "failed") settleKept(outcome);
  }, [draftRef, keepAndReadBack, settleKept]);

  // One draft at a time: starting a Write while the loop's draft or the
  // chat's suggested draft is on screen asks first, then discards the one
  // and dismisses the other. Sending a chat message asks the same about the
  // loop's draft (confirmDiscardDraft).
  const { resolve: resolveBundle } = useResolveBundle();
  // The request outlives `confirmOpen`, so the copy holds while it closes.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest>({
    kind: "write",
    loopDraft: true,
    chatDraft: false,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback((request: ConfirmRequest) => {
    confirmResolveRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmRequest(request);
      setConfirmOpen(true);
    });
  }, []);
  const settleConfirm = useCallback((ok: boolean) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmOpen(false);
    resolve?.(ok);
  }, []);
  const handleConfirmOpenChange = useCallback(
    (open: boolean) => {
      if (!open) settleConfirm(false);
    },
    [settleConfirm],
  );

  const guardStart = useCallback(
    async (start: () => Promise<void>) => {
      if (keepingRef.current) return;
      if (!draftRef.current && !chatDraftOps(stateRef.current.bundles)) {
        await start();
        return;
      }
      const confirmed = await ask({
        kind: "write",
        loopDraft: draftRef.current !== null,
        chatDraft: chatDraftOps(stateRef.current.bundles) !== null,
      });
      if (!confirmed || keepingRef.current) return;
      // Read again: a reply may have landed while the dialog was open. The
      // chat's draft goes first, so a refused dismissal keeps the loop's.
      const chat = chatDraftOps(stateRef.current.bundles);
      if (chat) {
        if (isBundleDecisionRunning()) {
          toast.info(DECISION_RUNNING);
          return;
        }
        if (!(await resolveBundle(chat.bundleId, "reject", chat.opIds))) {
          return;
        }
      }
      if (draftRef.current) discard();
      await start();
    },
    [ask, discard, draftRef, resolveBundle],
  );

  const confirmDiscardDraft = useCallback(async () => {
    if (keepingRef.current) {
      toast.info(KEEPING_WAIT);
      return false;
    }
    if (!draftRef.current) return true;
    const ok = await ask({ kind: "send", loopDraft: true, chatDraft: false });
    if (!ok) return false;
    if (keepingRef.current) {
      toast.info(KEEPING_WAIT);
      return false;
    }
    discard();
    return true;
  }, [ask, discard, draftRef]);

  const writeScene = useCallback(
    (sceneId: string, opts?: { momentIds?: string[] }) =>
      guardStart(async () => {
        endQueue();
        await startScene(sceneId, opts?.momentIds);
      }),
    [endQueue, guardStart, startScene],
  );
  const writeChapter = useCallback(
    (chapterId: string) => guardStart(() => runChapter(chapterId)),
    [guardStart, runChapter],
  );

  // A beat deleted or moved out of the scene leaves the draft; the rest stays.
  // A draft whose scene is gone, or with no beats left, can never be kept.
  // Re-checked once a Keep ends, since nothing changes while it runs.
  useEffect(() => {
    const current = draftRef.current;
    if (!current || isKeeping) return;
    const orphaned = orphanedDraftBeats(current, state.planItems);
    if (
      orphaned === "scene" ||
      (orphaned.size > 0 && orphaned.size === current.beats.length)
    ) {
      discard();
      return;
    }
    dropBeats(orphaned);
  }, [discard, draftRef, dropBeats, isKeeping, state.planItems]);

  const value = useMemo<WritingLoop>(
    () => ({
      draft,
      queue,
      isKeeping,
      writeScene,
      writeChapter,
      redoBeat,
      tryAgain,
      keepScene,
      stop,
      discard: discardWithUndo,
      confirmDiscardDraft,
    }),
    [
      confirmDiscardDraft,
      discardWithUndo,
      draft,
      isKeeping,
      keepScene,
      queue,
      redoBeat,
      stop,
      tryAgain,
      writeChapter,
      writeScene,
    ],
  );

  return createElement(
    WritingLoopContext.Provider,
    { value },
    createElement(
      ConfirmDiscardDraftContext.Provider,
      { value: confirmDiscardDraft },
      createElement(
        Fragment,
        null,
        children,
        createElement(StudioConfirmDialog, {
          ...confirmCopy(confirmRequest),
          destructive: true,
          onConfirm: () => settleConfirm(true),
          onOpenChange: handleConfirmOpenChange,
          open: confirmOpen,
        }),
      ),
    ),
  );
}

/** The loop's `confirmDiscardDraft`, without subscribing to its draft. */
export function useConfirmDiscardDraft(): WritingLoop["confirmDiscardDraft"] {
  const value = useContext(ConfirmDiscardDraftContext);
  if (!value) {
    throw new Error(
      "useConfirmDiscardDraft must be used inside WritingLoopProvider.",
    );
  }
  return value;
}

export function useWritingLoop(): WritingLoop {
  const value = useContext(WritingLoopContext);
  if (!value) {
    throw new Error("useWritingLoop must be used inside WritingLoopProvider.");
  }
  return value;
}
