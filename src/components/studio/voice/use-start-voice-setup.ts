"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { applyStudioVoicePicks } from "@/actions/studio/apply-studio-voice-picks";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioVoicePicksPreview } from "@/lib/studio/voice-contract";

/** One round of questions: ask the route, then apply what it staged. */
function usePicksRound(mode: "setup" | "more", errorMessage: string) {
  const { state, dispatch } = useStudioStore();
  const runAction = useRunStudioAction();
  const storyId = state.story.id;
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);

  const start = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setRunning(true);
    setFailed(false);
    try {
      const preview = await postStudioJson<StudioVoicePicksPreview>(
        "/api/studio/voice/picks",
        { storyId, mode },
      );
      if (mode === "more" && preview.picks.length === 0) {
        toast("Nothing more to ask right now.");
        return false;
      }
      const story = await runAction(
        applyStudioVoicePicks({ storyId, generationId: preview.generationId }),
        errorMessage,
      );
      if (!story) {
        setFailed(true);
        return false;
      }
      dispatch({ type: "merge", story });
      return true;
    } catch (error) {
      toast.error(studioErrorMessage(error, errorMessage));
      setFailed(true);
      return false;
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }, [dispatch, errorMessage, mode, runAction, storyId]);

  return { start, running, failed };
}

/**
 * Asks the model for the story's first voice questions and keeps them. Used by
 * the Voice tab's empty state and the new-story voice step.
 */
export function useStartVoiceSetup(): {
  start(): Promise<boolean>;
  running: boolean;
  failed: boolean;
} {
  return usePicksRound("setup", "Couldn't get the questions. Try again.");
}

/** "Ask me more": adds a few more questions to a voice that is already set up. */
export function useAskForMoreVoicePicks(): {
  start(): Promise<boolean>;
  running: boolean;
  failed: boolean;
} {
  return usePicksRound("more", "Couldn't get more questions.");
}
