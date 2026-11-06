"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import type {
  StudioCastRevisionApplyResult,
  StudioRefreshedFieldsApplyResult,
} from "@/actions/studio/_types";
import { applyStudioCastRevision } from "@/actions/studio/apply-studio-cast-revision";
import { applyStudioRefreshedFields } from "@/actions/studio/apply-studio-refreshed-fields";
import { updateStudioEntry } from "@/actions/studio/update-studio-entry";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
import {
  createRevisionSlots,
  newestRevision,
} from "@/components/studio/shared/revision-slots";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryDto, StudioEntryField } from "@/lib/studio/contracts";

export type EntryPatch = {
  name?: string;
  summary?: string;
  /** The full desired list; the server stamps changed fields as author-written. */
  fields?: StudioEntryField[];
  relatedEntryIds?: string[];
  customTypeLabel?: string;
};

type PatchInput = EntryPatch | ((latest: StudioEntryDto) => EntryPatch);

// Saves for one entry serialize across every caller, each against the newest
// revision seen, so two quick field edits never send the same revision twice.
const getSlot = createRevisionSlots<StudioEntryDto>();

const PATCH_FAILED_MESSAGE = "The entry could not be saved.";
// One toast id, so a run of conflicting autosaves shows a single message.
const PATCH_TOAST_ID = "studio-entry-patch";

/**
 * Saves entry fields through the revision compare-and-swap. A real conflict
 * toasts the server's message and resolves null, leaving the caller's local
 * value in place.
 */
export function usePatchEntry() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return useCallback(
    (entryId: string, input: PatchInput): Promise<StudioEntryDto | null> => {
      const slot = getSlot(`${storyId}:${entryId}`);
      const task = slot.queue.then(async () => {
        const stored = stateRef.current.entries.find((e) => e.id === entryId);
        const latest = newestRevision(stored, slot);
        if (!latest) return null;
        const patch = typeof input === "function" ? input(latest) : input;
        try {
          const result = await updateStudioEntry({
            storyId,
            entryId,
            expectedRevision: latest.revision,
            patch,
          });
          if (result?.data) {
            slot.newest = result.data;
            dispatch({ type: "merge", entries: [result.data] });
            return result.data;
          }
          toast.error(actionFailureMessage(result, PATCH_FAILED_MESSAGE), {
            id: PATCH_TOAST_ID,
          });
        } catch {
          toast.error(PATCH_FAILED_MESSAGE, { id: PATCH_TOAST_ID });
        }
        return null;
      });
      slot.queue = task.catch(() => null);
      return task;
    },
    [dispatch, storyId],
  );
}

/** Resolves once every save already queued for the entry has settled. */
export function waitForEntrySaves(
  storyId: string,
  entryId: string,
): Promise<unknown> {
  return getSlot(`${storyId}:${entryId}`).queue;
}

const CAST_REVISION_FAILED_MESSAGE = "The entry could not be revised.";

/**
 * Applies a staged cast revision through the same per-entry queue as field
 * edits. Like a details refresh it is revision-guarded: an edit made while
 * the AI worked makes it stale (`{ entry: null, stale: true }`). Resolves
 * null after toasting a failure.
 */
export function useApplyCastRevision() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;

  return useCallback(
    (
      entryId: string,
      generationId: string,
    ): Promise<StudioCastRevisionApplyResult | null> => {
      const slot = getSlot(`${storyId}:${entryId}`);
      const task = slot.queue.then(async () => {
        try {
          const result = await applyStudioCastRevision({
            storyId,
            entryId,
            generationId,
          });
          if (result?.data) {
            const saved = result.data.entry;
            if (
              saved &&
              (!slot.newest || saved.revision > slot.newest.revision)
            ) {
              slot.newest = saved;
            }
            if (saved) dispatch({ type: "merge", entries: [saved] });
            return result.data;
          }
          toast.error(
            actionFailureMessage(result, CAST_REVISION_FAILED_MESSAGE),
          );
        } catch {
          toast.error(CAST_REVISION_FAILED_MESSAGE);
        }
        return null;
      });
      slot.queue = task.catch(() => null);
      return task;
    },
    [dispatch, storyId],
  );
}

const REFRESH_TOAST_ID = "studio-entry-refresh";
const REFRESH_APPLY_FAILED_MESSAGE =
  "Couldn't update the details the AI keeps.";

/**
 * Applies a staged details refresh through the same per-entry queue as field
 * edits, so it never lands in the middle of an autosave. The server compares
 * against the revision the refresh read, so a newer edit makes it stale
 * (resolved `{ entry: null, stale: true }`, silent). Resolves null after
 * toasting a failure.
 */
export function useApplyRefreshedFields() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;

  return useCallback(
    (
      entryId: string,
      generationId: string,
    ): Promise<StudioRefreshedFieldsApplyResult | null> => {
      const slot = getSlot(`${storyId}:${entryId}`);
      const task = slot.queue.then(async () => {
        try {
          const result = await applyStudioRefreshedFields({
            storyId,
            entryId,
            generationId,
          });
          if (result?.data) {
            const saved = result.data.entry;
            if (
              saved &&
              (!slot.newest || saved.revision > slot.newest.revision)
            ) {
              slot.newest = saved;
            }
            if (saved) dispatch({ type: "merge", entries: [saved] });
            return result.data;
          }
          toast.error(
            actionFailureMessage(result, REFRESH_APPLY_FAILED_MESSAGE),
            { id: REFRESH_TOAST_ID },
          );
        } catch {
          toast.error(REFRESH_APPLY_FAILED_MESSAGE, { id: REFRESH_TOAST_ID });
        }
        return null;
      });
      slot.queue = task.catch(() => null);
      return task;
    },
    [dispatch, storyId],
  );
}
