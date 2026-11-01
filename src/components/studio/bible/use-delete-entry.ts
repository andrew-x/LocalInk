"use client";

import { useCallback } from "react";

import { deleteStudioEntry } from "@/actions/studio/delete-studio-entry";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryDto } from "@/lib/studio/contracts";

/**
 * Deletes an entry and mirrors the server's cleanup in the store: its changes
 * go, "about" references clear, and the id leaves every list that held it
 * (each touched record's revision moves up by one, as on the server).
 */
export function useDeleteEntry() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const { changes, entries, planItems } = state;

  return useCallback(
    async (entry: StudioEntryDto): Promise<boolean> => {
      const removed = await run(
        deleteStudioEntry({ storyId, entryId: entry.id }),
        "The entry could not be deleted.",
      );
      if (!removed) return false;
      const id = removed.entryId;
      const without = (ids: string[]) => ids.filter((item) => item !== id);
      dispatch({
        type: "remove",
        entryIds: [id],
        changeIds: changes.filter((c) => c.entryId === id).map((c) => c.id),
      });
      dispatch({
        type: "merge",
        changes: changes
          .filter((c) => c.entryId !== id && c.aboutEntryId === id)
          .map((c) => ({ ...c, aboutEntryId: null })),
        entries: entries
          .filter((e) => e.id !== id && e.relatedEntryIds.includes(id))
          .map((e) => ({
            ...e,
            relatedEntryIds: without(e.relatedEntryIds),
            revision: e.revision + 1,
          })),
        planItems: planItems
          .filter(
            (item) =>
              item.presentEntryIds.includes(id) ||
              item.contextPinnedEntryIds.includes(id) ||
              item.contextExcludedEntryIds.includes(id),
          )
          .map((item) => ({
            ...item,
            presentEntryIds: without(item.presentEntryIds),
            contextPinnedEntryIds: without(item.contextPinnedEntryIds),
            contextExcludedEntryIds: without(item.contextExcludedEntryIds),
            revision: item.revision + 1,
          })),
      });
      return true;
    },
    [changes, dispatch, entries, planItems, run, storyId],
  );
}
