"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { keepStudioMomentDraft } from "@/actions/studio/keep-studio-moment-draft";
import { studioErrorMessage } from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { getOrderedMoments } from "@/lib/studio/plan-order";

import { flushMomentEditor, flushMomentEditors } from "./editor-registry";
import { readBackStudioMoment } from "./read-back-client";
import { useDraftStream, type WritingDraft } from "./use-draft-stream";
import { useSceneMomentPlanner } from "./use-scene-moment-planner";

export type { WritingDraft } from "./use-draft-stream";

const KEEP_FAILED = "The draft could not be kept. Please try again.";
const FLUSH_FAILED =
  "Your edits to this moment could not be saved, so the draft was not kept.";
const READ_BACK_FAILED =
  "The draft was kept, but the moment could not be re-read. Try Re-read in Inspect.";
const NOTHING_LEFT = "Everything in this scene is already written.";

export type WritingChain = {
  sceneId: string;
  autoKeep: boolean;
  /** 1-based position of the moment being written. */
  index: number;
  total: number;
};

export type WritingLoop = {
  draft: WritingDraft | null;
  write: (momentId: string, opts?: { again?: boolean }) => Promise<void>;
  keep: () => Promise<void>;
  stop: () => void;
  discard: () => void;
  writeRestOfScene: (
    sceneOrMomentId: string,
    autoKeep: boolean,
  ) => Promise<void>;
  /** Plans a scene's moments when it has none, then writes the first unwritten one. */
  startScene: (sceneId: string) => Promise<void>;
  chain: WritingChain | null;
  isKeeping: boolean;
  /** The scene whose moments are being planned before writing. */
  preparingSceneId: string | null;
};

type KeepOutcome = "kept" | "kept-unread" | "failed";
type ChainDecision = "kept" | "end";

const WritingLoopContext = createContext<WritingLoop | null>(null);

/**
 * One writing loop per workspace, shared by the manuscript, the plan tree and
 * Inspect. Drafts stream from the moment-prose route, which stages only
 * complete text; Keep persists the staged draft through the revision
 * compare-and-swap and then runs read-back.
 */
export function WritingLoopProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [draft, setDraft] = useState<WritingDraft | null>(null);
  const draftRef = useRef<WritingDraft | null>(null);
  const commitDraft = useCallback((next: WritingDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  /** The running stream or flesh-out request. */
  const requestRef = useRef<AbortController | null>(null);
  // The route builds context from saved prose, so land pending edits up to
  // and including the target first (the previous moment's 800 ms autosave
  // may not have fired yet).
  const flushBefore = useCallback(async (momentId: string) => {
    const ordered = getOrderedMoments(stateRef.current.planItems);
    const index = ordered.findIndex((moment) => moment.id === momentId);
    const upTo = index === -1 ? ordered : ordered.slice(0, index + 1);
    return flushMomentEditors(upTo.map((moment) => moment.id));
  }, []);
  const { cancelFrame, getLatestStream, stream } = useDraftStream({
    commitDraft,
    draftRef,
    flushBefore,
    requestRef,
    storyId,
  });

  const [chain, setChain] = useState<WritingChain | null>(null);
  const chainRef = useRef<{
    token: number;
    decide: ((decision: ChainDecision) => void) | null;
  } | null>(null);
  const chainTokenRef = useRef(0);

  const [isKeeping, setIsKeeping] = useState(false);
  const keepingRef = useRef(false);
  const getPlanItems = useCallback(() => stateRef.current.planItems, []);
  const { planSceneMoments, preparingSceneId } = useSceneMomentPlanner({
    getPlanItems,
    requestRef,
    storyId,
  });

  const endChain = useCallback(() => {
    const current = chainRef.current;
    if (!current) return;
    chainRef.current = null;
    current.decide?.("end");
    setChain(null);
  }, []);

  const keepDraft = useCallback(async (): Promise<KeepOutcome> => {
    const current = draftRef.current;
    if (current?.status !== "ready" || keepingRef.current) {
      return "failed";
    }
    keepingRef.current = true;
    setIsKeeping(true);
    try {
      const stored = stateRef.current.prose.find(
        (prose) => prose.momentId === current.momentId,
      );
      // Land the author's pending edits first so they become a version.
      const expectedRevision = await flushMomentEditor(
        current.momentId,
        stored?.revision ?? 0,
      );
      if (expectedRevision === null) {
        toast.error(FLUSH_FAILED);
        return "failed";
      }
      const kept = await run(
        keepStudioMomentDraft({
          storyId,
          momentId: current.momentId,
          generationId: current.generationId,
          expectedRevision,
        }),
        KEEP_FAILED,
      );
      if (!kept) return "failed";
      dispatch({ type: "merge", prose: [kept] });
      if (draftRef.current?.generationId === current.generationId) {
        commitDraft(null);
      }
    } finally {
      keepingRef.current = false;
      setIsKeeping(false);
    }

    // Read back right away so confirmed changes land before the next moment.
    try {
      const patch = await readBackStudioMoment({
        storyId,
        momentId: current.momentId,
        force: true,
      });
      if (patch) dispatch({ type: "merge", ...patch });
      return "kept";
    } catch (error) {
      toast.error(studioErrorMessage(error, READ_BACK_FAILED));
      return "kept-unread";
    }
  }, [commitDraft, dispatch, run, storyId]);

  const write = useCallback(
    async (momentId: string, opts?: { again?: boolean }) => {
      if (keepingRef.current) return;
      // Try again on the chain's current moment keeps the chain waiting.
      const retryingChain =
        opts?.again === true && draftRef.current?.momentId === momentId;
      if (!retryingChain) endChain();
      await stream(momentId, opts?.again ? "again" : "first");
    },
    [endChain, stream],
  );

  const keep = useCallback(async () => {
    const outcome = await keepDraft();
    const pending = chainRef.current;
    if (outcome === "failed" || !pending?.decide) return;
    const decide = pending.decide;
    pending.decide = null;
    decide(outcome === "kept" ? "kept" : "end");
  }, [keepDraft]);

  const stop = useCallback(() => {
    // The stream's own error path marks the partial draft as stopped.
    requestRef.current?.abort();
    endChain();
  }, [endChain]);

  const discard = useCallback(() => {
    if (keepingRef.current) return;
    const controller = requestRef.current;
    requestRef.current = null;
    controller?.abort();
    cancelFrame();
    commitDraft(null);
    endChain();
  }, [cancelFrame, commitDraft, endChain]);

  const startScene = useCallback(
    async (sceneId: string) => {
      if (keepingRef.current) return;
      endChain();
      const moments = await planSceneMoments(sceneId);
      if (!moments || moments.length === 0) return;
      const prose = new Map(
        stateRef.current.prose.map((item) => [item.momentId, item]),
      );
      const next =
        moments.find((moment) => !prose.get(moment.id)?.markdown.trim()) ??
        null;
      if (!next) {
        toast.error(NOTHING_LEFT);
        return;
      }
      await stream(next.id, "first");
    },
    [endChain, planSceneMoments, stream],
  );

  const writeRestOfScene = useCallback(
    async (sceneOrMomentId: string, autoKeep: boolean) => {
      if (keepingRef.current) return;
      const item = stateRef.current.planItems.find(
        (candidate) => candidate.id === sceneOrMomentId,
      );
      if (!item || item.kind === "chapter") return;
      const sceneId = item.kind === "scene" ? item.id : item.parentId;
      if (!sceneId) return;

      endChain();
      const token = ++chainTokenRef.current;
      chainRef.current = { token, decide: null };
      const isActive = () => chainRef.current?.token === token;

      try {
        const moments = await planSceneMoments(sceneId);
        if (!moments || moments.length === 0 || !isActive()) return;
        const prose = new Map(
          stateRef.current.prose.map((entry) => [entry.momentId, entry]),
        );
        const startIndex =
          item.kind === "moment"
            ? Math.max(
                0,
                moments.findIndex((moment) => moment.id === item.id),
              )
            : 0;
        const queue = moments
          .slice(startIndex)
          .filter((moment) => !prose.get(moment.id)?.markdown.trim());
        if (queue.length === 0) {
          toast.error(NOTHING_LEFT);
          return;
        }

        for (const [index, moment] of queue.entries()) {
          if (!isActive()) return;
          setChain({
            sceneId,
            autoKeep,
            index: index + 1,
            total: queue.length,
          });
          let pending = stream(moment.id, "first");
          let result = await pending;
          // Try again on this moment supersedes the stream; follow the new one.
          let latest = getLatestStream();
          while (
            result === null &&
            isActive() &&
            latest &&
            latest !== pending
          ) {
            pending = latest;
            result = await pending;
            latest = getLatestStream();
          }
          if (!isActive() || result?.status !== "ready") return;
          if (autoKeep) {
            if ((await keepDraft()) !== "kept") return;
            continue;
          }
          const decision = await new Promise<ChainDecision>((resolve) => {
            const pending = chainRef.current;
            if (pending?.token === token) pending.decide = resolve;
            else resolve("end");
          });
          if (decision !== "kept") return;
        }
      } finally {
        if (chainRef.current?.token === token) {
          chainRef.current = null;
          setChain(null);
        }
      }
    },
    [endChain, getLatestStream, keepDraft, planSceneMoments, stream],
  );

  // A draft for a moment that no longer exists can never be kept.
  useEffect(() => {
    const current = draftRef.current;
    if (current && !state.planItems.some((i) => i.id === current.momentId)) {
      discard();
    }
  }, [discard, state.planItems]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      requestRef.current = null;
      chainRef.current?.decide?.("end");
      chainRef.current = null;
    },
    [],
  );

  const value = useMemo<WritingLoop>(
    () => ({
      draft,
      write,
      keep,
      stop,
      discard,
      writeRestOfScene,
      startScene,
      chain,
      isKeeping,
      preparingSceneId,
    }),
    [
      chain,
      discard,
      draft,
      isKeeping,
      keep,
      preparingSceneId,
      startScene,
      stop,
      write,
      writeRestOfScene,
    ],
  );

  return createElement(WritingLoopContext.Provider, { value }, children);
}

export function useWritingLoop(): WritingLoop {
  const value = useContext(WritingLoopContext);
  if (!value) {
    throw new Error("useWritingLoop must be used inside WritingLoopProvider.");
  }
  return value;
}
