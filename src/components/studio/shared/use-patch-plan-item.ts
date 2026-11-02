"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { updateStudioPlanItem } from "@/actions/studio/update-studio-plan-item";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { createRevisionSlots, newestRevision } from "./revision-slots";

export type PlanItemPatch = Partial<
  Pick<
    StudioPlanItemDto,
    | "title"
    | "whatHappens"
    | "howToWrite"
    | "craft"
    | "presentEntryIds"
    | "contextPinnedEntryIds"
    | "contextExcludedEntryIds"
  >
>;

type PatchInput =
  | PlanItemPatch
  | ((latest: StudioPlanItemDto) => PlanItemPatch);

// Saves for one plan item serialize across every caller (fields, chips,
// craft, tree rename), each against the newest revision seen. Keyed by
// story and item, so it outlives any single component.
const getSlot = createRevisionSlots<StudioPlanItemDto>();

const PATCH_FAILED_MESSAGE = "The change could not be saved.";
// One toast id, so a run of conflicting autosaves shows a single message.
const PATCH_TOAST_ID = "studio-plan-item-patch";

/**
 * Saves plan item fields through the revision compare-and-swap. Saves for an
 * item run one at a time across all callers, each against the newest revision seen, so quick
 * successive edits never conflict with each other. A real conflict (the item
 * changed elsewhere) toasts the server's message and resolves null, leaving
 * the caller's local value in place.
 */
export function usePatchPlanItem() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  return useCallback(
    (itemId: string, input: PatchInput): Promise<StudioPlanItemDto | null> => {
      const slot = getSlot(`${storyId}:${itemId}`);
      const task = slot.queue.then(async () => {
        const stored = stateRef.current.planItems.find((i) => i.id === itemId);
        const latest = newestRevision(stored, slot);
        if (!latest) return null;
        const patch = typeof input === "function" ? input(latest) : input;
        try {
          const result = await updateStudioPlanItem({
            storyId,
            itemId,
            expectedRevision: latest.revision,
            patch,
          });
          if (result?.data) {
            slot.newest = result.data;
            dispatch({ type: "merge", planItems: [result.data] });
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
