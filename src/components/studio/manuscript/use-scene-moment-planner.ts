"use client";

import { type RefObject, useCallback, useState } from "react";
import { toast } from "sonner";

import { applyStudioPlan } from "@/actions/studio/apply-studio-plan";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { getOrderedMoments } from "@/lib/studio/plan-order";
import type { StudioPlanPreview } from "@/lib/studio/planning-contract";

const PLAN_FAILED =
  "The moments for this scene could not be planned. Please try again.";
const PLAN_SAVE_FAILED =
  "The planned moments could not be saved. Please try again.";
const NOTHING_PLANNED = "No moments were planned for this scene.";

export function momentsOfScene(
  items: StudioPlanItemDto[],
  sceneId: string,
): StudioPlanItemDto[] {
  return getOrderedMoments(items).filter((item) => item.parentId === sceneId);
}

/**
 * §8.2: writing a scene with no moments first plans them (plan route, then
 * apply). Shares the writing loop's request slot so Stop cancels planning too.
 */
export function useSceneMomentPlanner({
  getPlanItems,
  requestRef,
  storyId,
}: {
  getPlanItems: () => StudioPlanItemDto[];
  requestRef: RefObject<AbortController | null>;
  storyId: string;
}) {
  const { dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const [preparingSceneId, setPreparingSceneId] = useState<string | null>(null);

  /** Resolves to the scene's moments in order, or null when cancelled or failed. */
  const planSceneMoments = useCallback(
    async (sceneId: string): Promise<StudioPlanItemDto[] | null> => {
      const existing = momentsOfScene(getPlanItems(), sceneId);
      if (existing.length > 0) return existing;

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setPreparingSceneId(sceneId);
      try {
        const preview = await postStudioJson<StudioPlanPreview>(
          "/api/studio/plan",
          { mode: "flesh-out", storyId, targetItemId: sceneId },
          controller.signal,
        );
        if (requestRef.current !== controller) return null;
        const workspace = await run(
          applyStudioPlan({
            storyId,
            generationId: preview.generationId,
            mode: "flesh-out",
            targetItemId: sceneId,
          }),
          PLAN_SAVE_FAILED,
        );
        if (!workspace) return null;
        // The server committed, so the store follows even if Stop came late.
        dispatch({ type: "replace", workspace });
        if (controller.signal.aborted) return null;
        const moments = momentsOfScene(workspace.planItems, sceneId);
        if (moments.length === 0) toast.error(NOTHING_PLANNED);
        return moments;
      } catch (error) {
        if (controller.signal.aborted) return null;
        toast.error(studioErrorMessage(error, PLAN_FAILED));
        return null;
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        setPreparingSceneId((current) =>
          current === sceneId ? null : current,
        );
      }
    },
    [dispatch, getPlanItems, requestRef, run, storyId],
  );

  return { planSceneMoments, preparingSceneId };
}
