"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { splitStudioMoment } from "@/actions/studio/split-studio-moment";
import { studioErrorMessage } from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";

import { getMomentEditor } from "./editor-registry";
import { readBackStudioMoment } from "./read-back-client";

const SPLIT_SAVE_FAILED =
  "This moment has unsaved edits, so it could not be split.";
const SPLIT_POSITION =
  "Select where the new moment should start: after some text, and before the end.";
const SPLIT_FAILED = "The moment could not be split. Please try again.";
const SPLIT_READ_BACK_FAILED =
  "The moment was split, but it could not be re-read. Try Re-read in Inspect.";

/**
 * "Split moment here": flushes autosave, splits at the selection start through
 * the revision compare-and-swap, then reads both halves back so the new
 * moment gets a plan.
 */
export function useSplitMoment({
  flush,
  momentId,
  storyId,
}: {
  flush: () => Promise<number | null>;
  momentId: string;
  storyId: string;
}) {
  const { dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const [isSplitting, setIsSplitting] = useState(false);

  const readBackHalves = useCallback(
    async (momentIds: string[]) => {
      try {
        for (const id of momentIds) {
          const patch = await readBackStudioMoment({
            storyId,
            momentId: id,
            force: false,
          });
          if (patch) dispatch({ type: "merge", ...patch });
        }
      } catch (error) {
        toast.error(studioErrorMessage(error, SPLIT_READ_BACK_FAILED));
      }
    },
    [dispatch, storyId],
  );

  const splitHere = useCallback(async (): Promise<boolean> => {
    if (isSplitting) return false;
    setIsSplitting(true);
    try {
      const revision = await flush();
      if (revision === null) {
        toast.error(SPLIT_SAVE_FAILED);
        return false;
      }
      const split =
        getMomentEditor(momentId)?.getMarkdownSplitAtSelection() ?? null;
      if (!split?.before || !split.after) {
        toast.error(SPLIT_POSITION);
        return false;
      }
      const result = await run(
        splitStudioMoment({
          storyId,
          momentId,
          expectedRevision: revision,
          beforeMarkdown: split.before,
          afterMarkdown: split.after,
        }),
        SPLIT_FAILED,
      );
      if (!result) return false;
      dispatch({
        type: "merge",
        prose: result.prose,
        planItems: result.planItems,
      });
      void readBackHalves(result.prose.map((prose) => prose.momentId));
      return true;
    } finally {
      setIsSplitting(false);
    }
  }, [dispatch, flush, isSplitting, momentId, readBackHalves, run, storyId]);

  return { isSplitting, splitHere };
}
