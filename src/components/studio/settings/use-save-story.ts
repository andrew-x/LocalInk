"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type {
  StudioStoryDto,
  StudioStructureTemplateId,
} from "@/lib/studio/contracts";

export type StoryPatch = {
  overview?: string;
  theme?: string;
  instructions?: string;
  structureTemplate?: StudioStructureTemplateId;
  structureNotes?: string;
};

const SAVE_FAILED_MESSAGE = "The story could not be saved.";
const SAVE_TOAST_ID = "studio-story-patch";

// Story patches are last-write-wins; one chain per story keeps them in order.
const queues = new Map<string, Promise<unknown>>();

/** Saves story-level fields. Resolves the saved story, or null after a toast. */
export function useSaveStory() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;

  return useCallback(
    (patch: StoryPatch): Promise<StudioStoryDto | null> => {
      const task = (queues.get(storyId) ?? Promise.resolve()).then(async () => {
        try {
          const result = await updateStudioStory({ storyId, patch });
          if (result?.data) {
            dispatch({ type: "merge", story: result.data });
            return result.data;
          }
          toast.error(actionFailureMessage(result, SAVE_FAILED_MESSAGE), {
            id: SAVE_TOAST_ID,
          });
        } catch {
          toast.error(SAVE_FAILED_MESSAGE, { id: SAVE_TOAST_ID });
        }
        return null;
      });
      queues.set(
        storyId,
        task.catch(() => null),
      );
      return task;
    },
    [dispatch, storyId],
  );
}
