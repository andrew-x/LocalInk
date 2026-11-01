"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { snapshotStudioMomentProse } from "@/actions/studio/snapshot-studio-moment-prose";
import { updateStudioMomentProse } from "@/actions/studio/update-studio-moment-prose";
import {
  StudioRequestError,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioProseDto } from "@/lib/studio/contracts";

import {
  clearMomentSaveState,
  type MomentSaveState,
  setMomentSaveState,
} from "./editor-registry";
import { actionFailureMessage, readBackStudioMoment } from "./read-back-client";

const AUTOSAVE_DELAY_MS = 800;
/**
 * Settle work (version snapshot + read-back) waits for the moment to rest,
 * like the story editor's synopsis refresh: each read-back is a model call.
 */
const SETTLE_DELAY_MS = 10_000;
const SAVE_FAILED_MESSAGE =
  "This moment could not be saved. Your writing is kept here.";
const READ_BACK_FAILED_MESSAGE =
  "The moment could not be re-read. It will try again after your next edit.";
const BIND_FAILED_MESSAGE =
  "A new moment could not be created for your writing. Keep typing to try again.";

type UseMomentAutosaveOptions = {
  storyId: string;
  /** Null for the continue editor until its first keystroke binds a moment. */
  momentId: string | null;
  initialMarkdown: string;
  initialRevision: number;
  /** Creates the moment an unbound editor writes into. */
  createMoment?: () => Promise<string | null>;
};

export type MomentAutosave = {
  /** The moment this editor saves into, once known. */
  boundMomentId: string | null;
  handleMarkdownChange: (markdown: string) => void;
  flush: () => Promise<number | null>;
  retry: () => void;
  /**
   * Called when the store holds a newer revision written elsewhere (Keep,
   * split, restore). Returns true when the editor should load it; a dirty
   * editor keeps its text, and its next save loses the compare-and-swap.
   */
  adoptExternal: (prose: StudioProseDto) => boolean;
};

/**
 * Adapted from the story editor's autosave: an 800 ms debounce, one save in
 * flight at a time, compare-and-swap on the prose revision, and a paused
 * queue after a failed save so the text stays local and never overwrites.
 */
export function useMomentAutosave({
  storyId,
  momentId,
  initialMarkdown,
  initialRevision,
  createMoment,
}: UseMomentAutosaveOptions): MomentAutosave {
  const { dispatch } = useStudioStore();
  const [createdMomentId, setCreatedMomentId] = useState<string | null>(null);
  const boundMomentId = momentId ?? createdMomentId;

  const momentIdRef = useRef(boundMomentId);
  const createMomentRef = useRef(createMoment);
  const acknowledgedRevisionRef = useRef(initialRevision);
  const lastSavedRef = useRef(initialMarkdown);
  const latestRef = useRef(initialMarkdown);
  const inFlightRef = useRef(0);
  const blockedRef = useRef(false);
  const bindingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleAbortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveToastShownRef = useRef(false);
  const settleToastShownRef = useRef(false);
  const isMountedRef = useRef(true);
  const retryRef = useRef(() => {});

  useEffect(() => {
    createMomentRef.current = createMoment;
  }, [createMoment]);

  useEffect(() => {
    if (boundMomentId) momentIdRef.current = boundMomentId;
  }, [boundMomentId]);

  const setSaveState = useCallback((state: MomentSaveState) => {
    const id = momentIdRef.current;
    if (id && isMountedRef.current) setMomentSaveState(id, state);
  }, []);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const cancelSettle = useCallback(() => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    settleAbortRef.current?.abort();
    settleAbortRef.current = null;
  }, []);

  const runSettle = useCallback(async () => {
    const id = momentIdRef.current;
    // A later save reschedules settle work, so skip while edits are pending.
    if (
      !id ||
      blockedRef.current ||
      latestRef.current !== lastSavedRef.current
    ) {
      return;
    }
    const controller = new AbortController();
    settleAbortRef.current = controller;
    try {
      const snapshot = await snapshotStudioMomentProse({
        storyId,
        momentId: id,
      });
      if (!snapshot?.data) {
        throw new StudioRequestError(
          actionFailureMessage(snapshot, READ_BACK_FAILED_MESSAGE),
        );
      }
      if (controller.signal.aborted) return;
      const patch = await readBackStudioMoment({
        storyId,
        momentId: id,
        force: false,
        signal: controller.signal,
      });
      if (patch) dispatch({ type: "merge", ...patch });
      settleToastShownRef.current = false;
    } catch (error) {
      if (controller.signal.aborted || !isMountedRef.current) return;
      if (!settleToastShownRef.current) {
        settleToastShownRef.current = true;
        toast.error(studioErrorMessage(error, READ_BACK_FAILED_MESSAGE));
      }
    } finally {
      if (settleAbortRef.current === controller) settleAbortRef.current = null;
    }
  }, [dispatch, storyId]);

  const scheduleSettle = useCallback(() => {
    cancelSettle();
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      void runSettle();
    }, SETTLE_DELAY_MS);
  }, [cancelSettle, runSettle]);

  const save = useCallback(
    async (markdown: string, updateState: boolean): Promise<boolean> => {
      const id = momentIdRef.current;
      if (!id) return false;
      inFlightRef.current += 1;
      if (updateState) setSaveState("saving");

      let result: Awaited<ReturnType<typeof updateStudioMomentProse>> | null =
        null;
      try {
        result = await updateStudioMomentProse({
          storyId,
          momentId: id,
          markdown,
          expectedRevision: acknowledgedRevisionRef.current,
        });
      } catch {
        result = null;
      } finally {
        inFlightRef.current -= 1;
      }

      if (!result?.data) {
        // Pause the queue: the text stays in the editor and nothing retries
        // with a newer revision on its own.
        blockedRef.current = true;
        setSaveState("error");
        // Sonner is global, so a save that fails after its editor unmounted
        // still tells the author. Retry is offered only while the editor is
        // mounted, and never for a conflict: the same revision cannot win.
        if (!saveToastShownRef.current) {
          saveToastShownRef.current = true;
          const canRetry =
            isMountedRef.current && result?.serverError?.code !== "CONFLICT";
          toast.error(
            actionFailureMessage(result, SAVE_FAILED_MESSAGE),
            canRetry
              ? {
                  action: { label: "Retry", onClick: () => retryRef.current() },
                }
              : undefined,
          );
        }
        return false;
      }

      blockedRef.current = false;
      saveToastShownRef.current = false;
      acknowledgedRevisionRef.current = result.data.revision;
      lastSavedRef.current = result.data.markdown;
      dispatch({ type: "merge", prose: [result.data] });
      if (isMountedRef.current) {
        setSaveState(
          latestRef.current === result.data.markdown ? "saved" : "pending",
        );
        scheduleSettle();
      }
      return true;
    },
    [dispatch, scheduleSettle, setSaveState, storyId],
  );

  const enqueue = useCallback(
    (markdown: string, updateState: boolean) => {
      const next = queueRef.current
        .catch(() => false)
        .then(() => (blockedRef.current ? false : save(markdown, updateState)));
      queueRef.current = next;
      return next;
    },
    [save],
  );

  const queueSave = useCallback(() => {
    clearSaveTimer();
    if (blockedRef.current || !momentIdRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void enqueue(latestRef.current, true);
    }, AUTOSAVE_DELAY_MS);
  }, [clearSaveTimer, enqueue]);

  const bindMoment = useCallback(() => {
    const create = createMomentRef.current;
    if (momentIdRef.current || bindingRef.current || !create) return;
    bindingRef.current = true;
    void create()
      .then((id) => {
        if (!id) return;
        momentIdRef.current = id;
        if (!isMountedRef.current) return;
        setCreatedMomentId(id);
        if (latestRef.current !== lastSavedRef.current) {
          setSaveState("pending");
          queueSave();
        }
      })
      .catch((error: unknown) => {
        if (isMountedRef.current) {
          toast.error(studioErrorMessage(error, BIND_FAILED_MESSAGE));
        }
      })
      .finally(() => {
        bindingRef.current = false;
      });
  }, [queueSave, setSaveState]);

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      latestRef.current = markdown;
      cancelSettle();

      if (blockedRef.current) {
        clearSaveTimer();
        setSaveState("error");
        return;
      }
      if (markdown === lastSavedRef.current && inFlightRef.current === 0) {
        clearSaveTimer();
        setSaveState("saved");
        return;
      }
      if (!momentIdRef.current) {
        if (markdown.trim()) bindMoment();
        return;
      }
      setSaveState("pending");
      queueSave();
    },
    [bindMoment, cancelSettle, clearSaveTimer, queueSave, setSaveState],
  );

  const flush = useCallback(async (): Promise<number | null> => {
    clearSaveTimer();
    await queueRef.current.catch(() => false);
    if (blockedRef.current) return null;
    if (!momentIdRef.current) {
      return latestRef.current.trim() ? null : acknowledgedRevisionRef.current;
    }
    if (latestRef.current !== lastSavedRef.current) {
      const saved = await enqueue(latestRef.current, true);
      if (!saved) return null;
    }
    return acknowledgedRevisionRef.current;
  }, [clearSaveTimer, enqueue]);

  const retry = useCallback(() => {
    if (!blockedRef.current) return;
    blockedRef.current = false;
    saveToastShownRef.current = false;
    clearSaveTimer();
    void enqueue(latestRef.current, true);
  }, [clearSaveTimer, enqueue]);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  const adoptExternal = useCallback(
    (prose: StudioProseDto): boolean => {
      if (prose.revision <= acknowledgedRevisionRef.current) return false;
      if (
        latestRef.current !== lastSavedRef.current ||
        inFlightRef.current > 0 ||
        blockedRef.current
      ) {
        return false;
      }
      clearSaveTimer();
      cancelSettle();
      acknowledgedRevisionRef.current = prose.revision;
      lastSavedRef.current = prose.markdown;
      latestRef.current = prose.markdown;
      setSaveState("saved");
      return true;
    },
    [cancelSettle, clearSaveTimer, setSaveState],
  );

  // Unmount: save what is pending without touching state, stop settle work.
  const unmountRef = useRef(() => {});
  useEffect(() => {
    unmountRef.current = () => {
      clearSaveTimer();
      cancelSettle();
      if (
        momentIdRef.current &&
        !blockedRef.current &&
        latestRef.current !== lastSavedRef.current
      ) {
        void enqueue(latestRef.current, false);
      }
    };
  }, [cancelSettle, clearSaveTimer, enqueue]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      unmountRef.current();
      isMountedRef.current = false;
      if (momentIdRef.current) clearMomentSaveState(momentIdRef.current);
    };
  }, []);

  return {
    boundMomentId,
    handleMarkdownChange,
    flush,
    retry,
    adoptExternal,
  };
}
