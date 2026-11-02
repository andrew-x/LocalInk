"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { StudioWorkspace } from "@/lib/studio/contracts";
import { flattenPlan } from "@/lib/studio/plan-order";

import type { SceneDraft } from "./scene-draft-model";

const CHAPTER_DONE = "Everything in this chapter is already written.";

export type WritingQueue = { chapterId: string; index: number; total: number };

type QueueDecision = "kept" | "end";
type PlanState = Pick<StudioWorkspace, "planItems" | "prose">;

/** Scenes in the chapter that have no beats or an unwritten one, in plan order. */
function scenesToWrite(state: PlanState, chapterId: string): string[] {
  const written = new Set(
    state.prose
      .filter((entry) => entry.markdown.trim().length > 0)
      .map((entry) => entry.momentId),
  );
  const ordered = flattenPlan(state.planItems);
  return ordered
    .filter((item) => item.kind === "scene" && item.parentId === chapterId)
    .filter((scene) => {
      const beats = ordered.filter(
        (item) => item.kind === "moment" && item.parentId === scene.id,
      );
      return beats.length === 0 || beats.some((beat) => !written.has(beat.id));
    })
    .map((scene) => scene.id);
}

/**
 * Write on a chapter: drafts its scenes in order, and each scene waits for
 * Keep before the next one starts. Stop, Discard or another write ends it.
 */
export function useChapterQueue({
  draftRef,
  keepingRef,
  startScene,
  stateRef,
}: {
  draftRef: RefObject<SceneDraft | null>;
  keepingRef: RefObject<boolean>;
  startScene: (sceneId: string) => Promise<void>;
  stateRef: RefObject<PlanState>;
}) {
  const [queue, setQueue] = useState<WritingQueue | null>(null);
  const queueRef = useRef<{
    token: number;
    decide: ((decision: QueueDecision) => void) | null;
  } | null>(null);
  const tokenRef = useRef(0);

  const endQueue = useCallback(() => {
    const current = queueRef.current;
    if (!current) return;
    queueRef.current = null;
    current.decide?.("end");
    setQueue(null);
  }, []);

  /**
   * Called after a successful Keep scene. A scene that was not re-read would
   * leave the next one without its confirmed changes, so the queue ends there.
   */
  const settleKept = useCallback((outcome: "kept" | "unread") => {
    const pending = queueRef.current;
    if (!pending?.decide) return;
    const decide = pending.decide;
    pending.decide = null;
    decide(outcome === "kept" ? "kept" : "end");
  }, []);

  const runChapter = useCallback(
    async (chapterId: string) => {
      if (keepingRef.current) return;
      const sceneIds = scenesToWrite(stateRef.current, chapterId);
      if (sceneIds.length === 0) {
        toast.error(CHAPTER_DONE);
        return;
      }
      endQueue();
      const token = ++tokenRef.current;
      queueRef.current = { token, decide: null };
      const isActive = () => queueRef.current?.token === token;
      try {
        for (const [index, sceneId] of sceneIds.entries()) {
          if (!isActive()) return;
          // Written, deleted or moved since the queue started: skip it.
          if (!scenesToWrite(stateRef.current, chapterId).includes(sceneId)) {
            continue;
          }
          setQueue({ chapterId, index: index + 1, total: sceneIds.length });
          await startScene(sceneId);
          // Nothing drafted (planning failed, edits could not be saved): end.
          if (!isActive() || draftRef.current?.sceneId !== sceneId) return;
          // A failed beat does not end the queue: the author can redo it,
          // keep the scene, and the next one starts.
          const decision = await new Promise<QueueDecision>((resolve) => {
            const pending = queueRef.current;
            if (pending?.token === token) pending.decide = resolve;
            else resolve("end");
          });
          if (decision !== "kept") return;
        }
      } finally {
        if (queueRef.current?.token === token) {
          queueRef.current = null;
          setQueue(null);
        }
      }
    },
    [draftRef, endQueue, keepingRef, startScene, stateRef],
  );

  useEffect(() => endQueue, [endQueue]);

  return { endQueue, queue, runChapter, settleKept };
}
