"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { applyStudioVoiceChanges } from "@/actions/studio/apply-studio-voice-changes";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { describeStudioVoiceOp } from "@/lib/studio/voice";
import type { StudioVoiceChangesPreview } from "@/lib/studio/voice-contract";
import { useUpdateVoice } from "./use-update-voice";
import type { VoiceDrafts } from "./use-voice-drafts";

export type VoiceFeedbackInput = {
  kind: string;
  planItemId: string | null;
  /** A draft is named by generation, a kept sample by id. Never by text. */
  sample: { generationId: string } | { sampleId: string };
  complaint: string;
  previousText: string;
};

/**
 * "Not quite… what's off?": the route turns the note into pick and note
 * changes, they apply with an Undo toast, and the tab is written again.
 */
export function useVoiceFeedback({
  onNewNotes,
  write,
}: {
  onNewNotes: (noteIds: string[]) => void;
  write: VoiceDrafts["write"];
}): (input: VoiceFeedbackInput) => Promise<boolean> {
  const { state, dispatch } = useStudioStore();
  const runAction = useRunStudioAction();
  const updateVoice = useUpdateVoice();
  const storyId = state.story.id;
  const voiceRef = useRef(state.story.voice);
  useEffect(() => {
    voiceRef.current = state.story.voice;
  }, [state.story.voice]);

  return useCallback(
    async (input: VoiceFeedbackInput) => {
      let preview: StudioVoiceChangesPreview;
      try {
        preview = await postStudioJson<StudioVoiceChangesPreview>(
          "/api/studio/voice/feedback",
          {
            storyId,
            kind: input.kind,
            sample: input.sample,
            complaint: input.complaint,
          },
        );
      } catch (error) {
        toast.error(studioErrorMessage(error, "Couldn't use that note."));
        return false;
      }

      const before = voiceRef.current;
      const result = await runAction(
        applyStudioVoiceChanges({
          storyId,
          generationId: preview.generationId,
          source: "feedback",
          // The action adds the "feedback:" prefix itself.
          targetId: input.kind.toLowerCase(),
        }),
        "Couldn't use that note.",
      );
      if (!result) return false;

      dispatch({ type: "merge", story: result.story });
      const knownNotes = new Set(before.notes.map((note) => note.id));
      onNewNotes(
        result.story.voice.notes
          .filter((note) => !knownNotes.has(note.id))
          .map((note) => note.id),
      );

      const labels = preview.ops
        .map((op) => describeStudioVoiceOp(op, before))
        .filter((label): label is string => label !== null);
      const changedLabel =
        labels.length > 2
          ? `${labels.slice(0, 2).join("; ")} and ${labels.length - 2} more`
          : labels.join("; ");

      const { undoOps } = result;
      toast("Voice updated", {
        action:
          undoOps.length > 0
            ? { label: "Undo", onClick: () => void updateVoice(undoOps) }
            : undefined,
      });
      write(input.kind, input.planItemId, {
        previousText: input.previousText,
        changedLabel: changedLabel || undefined,
      });
      return true;
    },
    [dispatch, onNewNotes, runAction, storyId, updateVoice, write],
  );
}
