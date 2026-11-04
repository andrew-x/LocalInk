"use client";

import { useCallback } from "react";

import { updateStudioVoice } from "@/actions/studio/update-studio-voice";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioVoiceOp } from "@/lib/studio/voice";

/**
 * Applies voice ops and merges the saved story into the store. Resolves true
 * when saved; a failure toasts and resolves false.
 */
export function useUpdateVoice(): (ops: StudioVoiceOp[]) => Promise<boolean> {
  const { state, dispatch } = useStudioStore();
  const runAction = useRunStudioAction();
  const storyId = state.story.id;

  return useCallback(
    async (ops: StudioVoiceOp[]) => {
      const story = await runAction(
        updateStudioVoice({ storyId, ops }),
        "Couldn't save the voice.",
      );
      if (!story) return false;
      dispatch({ type: "merge", story });
      return true;
    },
    [dispatch, runAction, storyId],
  );
}
