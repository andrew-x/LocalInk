"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { actionFailureMessage } from "@/components/studio/manuscript/read-back-client";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type {
  StudioStoryDto,
  StudioStructureTemplateId,
  StudioStyle,
  StudioVoiceSample,
} from "@/lib/studio/contracts";

export type StoryPatch = {
  overview?: string;
  theme?: string;
  instructions?: string;
  /** Merged into the latest saved style when the save runs. */
  style?: Partial<StudioStyle>;
  voiceSamples?: StudioVoiceSample[];
  structureTemplate?: StudioStructureTemplateId;
  structureNotes?: string;
};

const SAVE_FAILED_MESSAGE = "The story could not be saved.";
const SAVE_TOAST_ID = "studio-story-patch";

// Story patches are last-write-wins; one chain per story keeps them in order.
const queues = new Map<string, Promise<unknown>>();
// The newest story a save returned; the store may not have re-rendered yet.
const lastSaved = new Map<string, StudioStoryDto>();

/** Saves story-level fields. Resolves the saved story, or null after a toast. */
export function useSaveStory() {
  const { state, dispatch } = useStudioStore();
  const storyId = state.story.id;
  const storyRef = useRef(state.story);
  useEffect(() => {
    storyRef.current = state.story;
  }, [state.story]);

  return useCallback(
    (patch: StoryPatch): Promise<StudioStoryDto | null> => {
      const task = (queues.get(storyId) ?? Promise.resolve()).then(async () => {
        try {
          const saved = lastSaved.get(storyId);
          const base =
            saved && saved.updatedAt > storyRef.current.updatedAt
              ? saved
              : storyRef.current;
          const { style, ...rest } = patch;
          const result = await updateStudioStory({
            storyId,
            patch: style
              ? { ...rest, style: { ...base.style, ...style } }
              : rest,
          });
          if (result?.data) {
            lastSaved.set(storyId, result.data);
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
