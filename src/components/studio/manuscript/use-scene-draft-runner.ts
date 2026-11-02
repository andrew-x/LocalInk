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
import { getOrderedMoments } from "@/lib/studio/plan-order";

import { flushMomentEditors } from "./editor-registry";
import {
  type BeatDraft,
  isSceneDraftRunning,
  orderedDraftBeats,
  precedingDraftsFor,
  type SceneDraft,
  withBeat,
  withBeatsQueued,
} from "./scene-draft-model";
import { type DraftStreamOptions, useDraftStream } from "./use-draft-stream";
import {
  momentsOfScene,
  useSceneMomentPlanner,
} from "./use-scene-moment-planner";

const NOTHING_LEFT = "Everything in this scene is already written.";
const NOTHING_TO_REWRITE = "There's nothing to rewrite in this scene.";
const UNSAVED_BEFORE =
  "Your latest edits could not be saved, so the draft was not started. The AI would have read older text.";

type BeatRun = {
  momentId: string;
  attempt: DraftStreamOptions["attempt"];
  note: string | null;
  /** The beat before a redo cleared it, put back if the redo cannot start. */
  previous?: BeatDraft;
};

function cleanNote(note: string | undefined): string | null {
  return note?.trim() || null;
}

/**
 * The scene draft and the chain that fills it: every target beat is streamed
 * in order, each against the earlier beats' unkept drafts, and the chain
 * halts at the first failure or Stop (later beats stay queued). A run token
 * makes every chain exit quietly once a newer run, Stop or Discard took over.
 */
export function useSceneDraftRunner({
  keepingRef,
  stateRef,
  storyId,
}: {
  keepingRef: RefObject<boolean>;
  stateRef: RefObject<Pick<StudioWorkspace, "planItems" | "prose">>;
  storyId: string;
}) {
  const [draft, setDraft] = useState<SceneDraft | null>(null);
  const draftRef = useRef<SceneDraft | null>(null);
  const commitDraft = useCallback((next: SceneDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const updateDraft = useCallback(
    (update: (current: SceneDraft) => SceneDraft) => {
      if (draftRef.current) commitDraft(update(draftRef.current));
    },
    [commitDraft],
  );

  /** The running stream or flesh-out request. */
  const requestRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);

  // The route builds context from saved prose, so land pending edits up to
  // and including the target first (an earlier moment's 800 ms autosave may
  // not have fired yet).
  const flushBefore = useCallback(
    async (momentId: string) => {
      const ordered = getOrderedMoments(stateRef.current.planItems);
      const index = ordered.findIndex((moment) => moment.id === momentId);
      const upTo = index === -1 ? ordered : ordered.slice(0, index + 1);
      return flushMomentEditors(upTo.map((moment) => moment.id));
    },
    [stateRef],
  );
  const onProgress = useCallback(
    (momentId: string, _generationId: string, text: string) => {
      const beat = draftRef.current?.beats.find(
        (candidate) => candidate.momentId === momentId,
      );
      if (beat?.status === "streaming") {
        updateDraft((current) => withBeat(current, momentId, { text }));
      }
    },
    [updateDraft],
  );
  const { cancelFrame, stream } = useDraftStream({
    flushBefore,
    onProgress,
    requestRef,
    storyId,
  });
  const getPlanItems = useCallback(
    () => stateRef.current.planItems,
    [stateRef],
  );
  const { planSceneMoments } = useSceneMomentPlanner({
    getPlanItems,
    requestRef,
    storyId,
  });

  /** Streams `runs` in order. Resolves when the run ends or is superseded. */
  const runBeats = useCallback(
    async (token: number, runs: BeatRun[]) => {
      const isActive = () => runRef.current === token;
      for (const run of runs) {
        const current = draftRef.current;
        if (!isActive() || !current) return;
        if (!current.beats.some((beat) => beat.momentId === run.momentId)) {
          continue;
        }
        const before =
          run.previous ??
          current.beats.find((beat) => beat.momentId === run.momentId);
        const precedingDrafts = precedingDraftsFor(
          current,
          run.momentId,
          stateRef.current.planItems,
        );
        commitDraft(
          withBeat(
            { ...current, status: "streaming", keepRefused: false },
            run.momentId,
            { status: "streaming", text: "", generationId: null },
          ),
        );
        const result = await stream(run.momentId, {
          attempt: run.attempt,
          note: run.note,
          precedingDrafts,
        });
        if (!isActive() || !result) return;
        if (result.status === "ready") {
          updateDraft((latest) =>
            withBeat(latest, run.momentId, {
              status: "ready",
              text: result.text,
              generationId: result.generationId,
            }),
          );
          continue;
        }
        if (result.expired) {
          // An earlier beat's staged draft is gone (restart or TTL). Mark the
          // beats it was drafted against for a redo and put this one back as
          // it was, instead of blanking it.
          const stale = new Set(precedingDrafts.map((entry) => entry.momentId));
          updateDraft((latest) => ({
            ...latest,
            status: "error",
            beats: latest.beats.map((beat) => {
              if (stale.has(beat.momentId)) {
                return { ...beat, status: "error", generationId: null };
              }
              if (beat.momentId === run.momentId) {
                return before ?? { ...beat, status: "queued", text: "" };
              }
              return beat;
            }),
          }));
          return;
        }
        // Halt: later beats stay queued until a redo or Try again.
        updateDraft((latest) => ({
          ...withBeat(latest, run.momentId, {
            status: "error",
            text: result.text,
            generationId: null,
          }),
          status: result.stopped ? "stopped" : "error",
        }));
        return;
      }
      if (!isActive()) return;
      updateDraft((latest) => ({
        ...latest,
        status: latest.beats.every((beat) => beat.status === "ready")
          ? "ready"
          : "error",
      }));
    },
    [commitDraft, stateRef, stream, updateDraft],
  );

  /**
   * Plans the scene's beats if it has none, then drafts the targets:
   * `momentIds` when given (a rewrite of written beats), otherwise every
   * beat without prose.
   */
  const startScene = useCallback(
    async (sceneId: string, momentIds?: string[]) => {
      const items = stateRef.current.planItems;
      if (keepingRef.current) return;
      if (items.find((item) => item.id === sceneId)?.kind !== "scene") return;
      const token = ++runRef.current;
      const isActive = () => runRef.current === token;
      const clearOwnDraft = () => {
        if (isActive() && draftRef.current?.sceneId === sceneId) {
          commitDraft(null);
        }
      };

      let beats = momentsOfScene(items, sceneId);
      if (beats.length === 0) {
        if (momentIds) {
          toast.error(NOTHING_TO_REWRITE);
          return;
        }
        commitDraft({ sceneId, beats: [], status: "planning" });
        const planned = await planSceneMoments(sceneId);
        if (!isActive()) return;
        if (!planned || planned.length === 0) {
          clearOwnDraft();
          return;
        }
        beats = planned;
      }

      const prose = new Map(
        stateRef.current.prose.map((entry) => [entry.momentId, entry]),
      );
      const written = (id: string) =>
        (prose.get(id)?.markdown.trim().length ?? 0) > 0;
      const targets = momentIds
        ? beats.filter((beat) => momentIds.includes(beat.id))
        : beats.filter((beat) => !written(beat.id));
      if (targets.length === 0) {
        toast.error(momentIds ? NOTHING_TO_REWRITE : NOTHING_LEFT);
        clearOwnDraft();
        return;
      }

      // Land edits before the draft shows: the route reads saved prose, and a
      // replaced beat's editor unmounts while its draft is on screen.
      const ordered = getOrderedMoments(stateRef.current.planItems).map(
        (moment) => moment.id,
      );
      const first = ordered.indexOf(targets[0].id);
      const flushIds = new Set([
        ...(first === -1 ? ordered : ordered.slice(0, first + 1)),
        ...targets.map((beat) => beat.id),
      ]);
      const flushed = await flushMomentEditors([...flushIds]);
      if (!isActive()) return;
      if (!flushed) {
        toast.error(UNSAVED_BEFORE);
        clearOwnDraft();
        return;
      }

      commitDraft({
        sceneId,
        status: "streaming",
        beats: targets.map((beat) => ({
          momentId: beat.id,
          generationId: null,
          text: "",
          status: "queued",
          replacesProse: written(beat.id),
        })),
      });
      await runBeats(
        token,
        targets.map((beat) => ({
          momentId: beat.id,
          attempt: written(beat.id) ? "again" : "first",
          note: null,
        })),
      );
    },
    [commitDraft, keepingRef, planSceneMoments, runBeats, stateRef],
  );

  /**
   * Redraws one beat against the same earlier beats. Later beats keep their
   * text; beats that never finished (the chain halted) are written after it.
   */
  const redoBeat = useCallback(
    async (momentId: string, note?: string) => {
      const current = draftRef.current;
      if (keepingRef.current || !current || isSceneDraftRunning(current)) {
        return;
      }
      const ordered = orderedDraftBeats(current, stateRef.current.planItems);
      const index = ordered.findIndex((beat) => beat.momentId === momentId);
      if (index === -1) return;
      const unfinished = ordered
        .slice(index + 1)
        .filter((beat) => beat.status !== "ready");
      const token = ++runRef.current;
      commitDraft(
        withBeatsQueued(
          current,
          new Set([momentId, ...unfinished.map((beat) => beat.momentId)]),
        ),
      );
      await runBeats(token, [
        {
          momentId,
          attempt: "again",
          note: cleanNote(note),
          previous: ordered[index],
        },
        ...unfinished.map(
          (beat): BeatRun => ({
            momentId: beat.momentId,
            attempt: beat.replacesProse ? "again" : "first",
            note: null,
          }),
        ),
      ]);
    },
    [commitDraft, keepingRef, runBeats, stateRef],
  );

  /** Redraws every beat of the draft in order, each with the same note. */
  const tryAgain = useCallback(
    async (note?: string) => {
      const current = draftRef.current;
      if (
        keepingRef.current ||
        !current ||
        current.beats.length === 0 ||
        isSceneDraftRunning(current)
      ) {
        return;
      }
      const ordered = orderedDraftBeats(current, stateRef.current.planItems);
      const token = ++runRef.current;
      commitDraft(
        withBeatsQueued(current, new Set(ordered.map((beat) => beat.momentId))),
      );
      await runBeats(
        token,
        ordered.map((beat) => ({
          momentId: beat.momentId,
          attempt: "again",
          note: cleanNote(note),
        })),
      );
    },
    [commitDraft, keepingRef, runBeats, stateRef],
  );

  const abortRequest = useCallback(() => {
    runRef.current++;
    const controller = requestRef.current;
    requestRef.current = null;
    controller?.abort();
    cancelFrame();
  }, [cancelFrame]);

  const discard = useCallback(() => {
    if (keepingRef.current) return;
    abortRequest();
    commitDraft(null);
  }, [abortRequest, commitDraft, keepingRef]);

  /** Planning has nothing to show, so Stop drops it; a stream keeps its partial beat. */
  const stop = useCallback(() => {
    const current = draftRef.current;
    if (current?.status === "planning") {
      discard();
      return;
    }
    if (current?.status !== "streaming") return;
    abortRequest();
    commitDraft({
      ...current,
      status: "stopped",
      beats: current.beats.map((beat) =>
        beat.status === "streaming"
          ? { ...beat, status: "error", generationId: null }
          : beat,
      ),
    });
  }, [abortRequest, commitDraft, discard]);

  useEffect(
    () => () => {
      runRef.current++;
      requestRef.current?.abort();
      requestRef.current = null;
    },
    [],
  );

  return {
    draft,
    draftRef,
    commitDraft,
    startScene,
    redoBeat,
    tryAgain,
    stop,
    discard,
  };
}
