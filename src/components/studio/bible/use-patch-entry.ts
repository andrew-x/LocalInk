"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { applyStudioSuggestedFields } from "@/actions/studio/apply-studio-suggested-fields";
import { updateStudioEntry } from "@/actions/studio/update-studio-entry";
import {
  createRevisionSlots,
  newestRevision,
} from "@/components/studio/inspect/revision-slots";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
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

const APPLY_FAILED_MESSAGE = "The suggestions could not be added.";

/**
 * Adds picked suggestions through the same per-entry queue as field edits, so
 * the compare-and-swap always uses the newest revision. Resolves the saved
 * entry, or null after toasting a failure.
 */
export function useApplyEntrySuggestions() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return useCallback(
    (
      entryId: string,
      generationId: string,
      pickedLabels: string[],
    ): Promise<StudioEntryDto | null> => {
      const slot = getSlot(`${storyId}:${entryId}`);
      const task = slot.queue.then(async () => {
        const stored = stateRef.current.entries.find((e) => e.id === entryId);
        const latest = newestRevision(stored, slot);
        if (!latest) return null;
        try {
          const result = await applyStudioSuggestedFields({
            storyId,
            entryId,
            generationId,
            pickedLabels,
            expectedRevision: latest.revision,
          });
          if (result?.data) {
            slot.newest = result.data;
            dispatch({ type: "merge", entries: [result.data] });
            return result.data;
          }
          toast.error(actionFailureMessage(result, APPLY_FAILED_MESSAGE));
        } catch {
          toast.error(APPLY_FAILED_MESSAGE);
        }
        return null;
      });
      slot.queue = task.catch(() => null);
      return task;
    },
    [dispatch, storyId],
  );
}
