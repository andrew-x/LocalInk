"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioRefreshFieldsPreview } from "@/lib/studio/suggest-fields-contract";

import { useApplyRefreshedFields } from "./use-patch-entry";

const REFRESH_DELAY_MS = 2_000;
const REFRESH_FAILED_MESSAGE = "Couldn't update the details the AI keeps.";
const REFRESH_TOAST_ID = "studio-entry-refresh";

type Pending = { timer: number | null; controller: AbortController | null };

// Module-level so a refresh the author triggered just before closing a card
// still runs. The apply is revision-guarded, so letting it finish is safe.
const pending = new Map<string, Pending>();

/**
 * Returns `(entryId) => void`: schedules a refresh of the entry's AI-owned
 * details (add, update, remove) from its saved paragraph. Debounced 2 s per
 * entry; a newer call cancels the older timer and aborts its request. Call it
 * after the paragraph is saved, never for a blank paragraph. Applying changes
 * only `fields`, so it cannot retrigger itself. Silent on abort or a stale
 * result; toasts a sanitized message on failure.
 */
export function useAutoDetails(): (entryId: string) => void {
  const { state } = useStudioStore();
  const storyId = state.story.id;
  const applyRefresh = useApplyRefreshedFields();

  return useCallback(
    (entryId: string) => {
      const key = `${storyId}:${entryId}`;
      const previous = pending.get(key);
      if (previous) {
        if (previous.timer !== null) window.clearTimeout(previous.timer);
        previous.controller?.abort();
      }
      const slot: Pending = { timer: null, controller: null };
      pending.set(key, slot);

      slot.timer = window.setTimeout(async () => {
        slot.timer = null;
        const controller = new AbortController();
        slot.controller = controller;
        try {
          const preview = await postStudioJson<StudioRefreshFieldsPreview>(
            "/api/studio/suggest-fields",
            { storyId, entryId },
            controller.signal,
          );
          if (controller.signal.aborted) return;
          await applyRefresh(entryId, preview.generationId);
        } catch (error) {
          if (controller.signal.aborted) return;
          toast.error(studioErrorMessage(error, REFRESH_FAILED_MESSAGE), {
            id: REFRESH_TOAST_ID,
          });
        } finally {
          if (pending.get(key) === slot) pending.delete(key);
        }
      }, REFRESH_DELAY_MS);
    },
    [applyRefresh, storyId],
  );
}
