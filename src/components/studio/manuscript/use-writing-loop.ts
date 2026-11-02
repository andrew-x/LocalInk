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
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";

import { flushMomentEditor } from "./editor-registry";
import { readBackStudioMoment } from "./read-back-client";
import {
  isSceneDraftKeepable,
  isSceneDraftOrphaned,
  orderedDraftBeats,
  type SceneDraft,
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
  discard: () => void;
};

type KeepOutcome = "kept" | "unread" | "failed";

const WritingLoopContext = createContext<WritingLoop | null>(null);

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

  // One draft at a time: starting another write while one is on screen asks
  // to discard it first.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingStartRef = useRef<(() => Promise<void>) | null>(null);
  const guardStart = useCallback(
    async (start: () => Promise<void>) => {
      if (keepingRef.current) return;
      if (!draftRef.current) {
        await start();
        return;
      }
      pendingStartRef.current = start;
      setConfirmOpen(true);
    },
    [draftRef],
  );
  const confirmDiscard = useCallback(() => {
    const start = pendingStartRef.current;
    pendingStartRef.current = null;
    setConfirmOpen(false);
    discard();
    if (start) void start();
  }, [discard]);
  const handleConfirmOpenChange = useCallback((open: boolean) => {
    if (open) return;
    pendingStartRef.current = null;
    setConfirmOpen(false);
  }, []);

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

  // A draft whose scene or beats were deleted can never be kept.
  useEffect(() => {
    const current = draftRef.current;
    if (current && isSceneDraftOrphaned(current, state.planItems)) discard();
  }, [discard, draftRef, state.planItems]);

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
      discard,
    }),
    [
      discard,
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
      Fragment,
      null,
      children,
      createElement(StudioConfirmDialog, {
        confirmLabel: "Discard and write",
        description:
          "Only one draft can be open at a time. The current draft hasn't been kept, so it will be thrown away.",
        destructive: true,
        onConfirm: confirmDiscard,
        onOpenChange: handleConfirmOpenChange,
        open: confirmOpen,
        title: "Discard the current draft?",
      }),
    ),
  );
}

export function useWritingLoop(): WritingLoop {
  const value = useContext(WritingLoopContext);
  if (!value) {
    throw new Error("useWritingLoop must be used inside WritingLoopProvider.");
  }
  return value;
}
