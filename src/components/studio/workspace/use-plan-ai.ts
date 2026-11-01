"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { applyStudioPlan } from "@/actions/studio/apply-studio-plan";
import { postStudioJson } from "@/components/studio/studio-fetch";
import type { StudioPlanPreview } from "@/lib/studio/planning-contract";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

export type PlanAiMode = "flesh-out" | "alternatives" | "rewrite-brief";

export type PlanAiPending = {
  mode: PlanAiMode;
  /** Planning can be cancelled; once applying, the server is committing. */
  phase: "planning" | "applying";
};

export type PlanAiAlternatives = {
  itemId: string;
  preview: StudioPlanPreview;
};

export type PlanAiController = {
  pending: ReadonlyMap<string, PlanAiPending>;
  alternatives: PlanAiAlternatives | null;
  start: (itemId: string, mode: PlanAiMode, instruction?: string) => void;
  applyOption: (optionIndex: number) => void;
  dismissAlternatives: () => void;
  cancel: (itemId: string) => void;
};

const PLAN_FAILED_MESSAGE =
  "The plan could not be generated. Please try again.";
const APPLY_FAILED_MESSAGE = "The plan could not be saved. Please try again.";

export function usePlanAi(): PlanAiController {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const controllers = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<Map<string, PlanAiPending>>(
    () => new Map(),
  );
  const [alternatives, setAlternatives] = useState<PlanAiAlternatives | null>(
    null,
  );

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  const setItemPending = useCallback(
    (itemId: string, value: PlanAiPending | null) => {
      setPending((current) => {
        const next = new Map(current);
        if (value) next.set(itemId, value);
        else next.delete(itemId);
        return next;
      });
    },
    [],
  );

  const apply = useCallback(
    async (
      itemId: string,
      preview: StudioPlanPreview,
      optionIndex: number | undefined,
    ) => {
      const workspace = await run(
        applyStudioPlan({
          storyId,
          generationId: preview.generationId,
          mode: preview.mode,
          targetItemId: itemId,
          optionIndex,
        }),
        APPLY_FAILED_MESSAGE,
      );
      if (workspace) dispatch({ type: "replace", workspace });
    },
    [dispatch, run, storyId],
  );

  const start = useCallback(
    (itemId: string, mode: PlanAiMode, instruction?: string) => {
      if (controllers.current.has(itemId)) return;
      const controller = new AbortController();
      controllers.current.set(itemId, controller);
      setItemPending(itemId, { mode, phase: "planning" });

      void (async () => {
        try {
          const preview = await postStudioJson<StudioPlanPreview>(
            "/api/studio/plan",
            {
              mode,
              storyId,
              targetItemId: itemId,
              ...(mode === "rewrite-brief" ? { instruction } : {}),
            },
            controller.signal,
          );
          if (controller.signal.aborted) return;

          if (mode === "alternatives") {
            setAlternatives({ itemId, preview });
            return;
          }
          setItemPending(itemId, { mode, phase: "applying" });
          await apply(itemId, preview, undefined);
        } catch (error) {
          if (controller.signal.aborted) return;
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : PLAN_FAILED_MESSAGE,
          );
        } finally {
          // A cancelled run was already cleared; never clear a newer run.
          if (controllers.current.get(itemId) === controller) {
            controllers.current.delete(itemId);
            setItemPending(itemId, null);
          }
        }
      })();
    },
    [apply, setItemPending, storyId],
  );

  const applyOption = useCallback(
    (optionIndex: number) => {
      const current = alternatives;
      if (!current || controllers.current.has(current.itemId)) return;
      setAlternatives(null);
      const controller = new AbortController();
      controllers.current.set(current.itemId, controller);
      setItemPending(current.itemId, {
        mode: "alternatives",
        phase: "applying",
      });
      void (async () => {
        try {
          await apply(current.itemId, current.preview, optionIndex);
        } finally {
          if (controllers.current.get(current.itemId) === controller) {
            controllers.current.delete(current.itemId);
            setItemPending(current.itemId, null);
          }
        }
      })();
    },
    [alternatives, apply, setItemPending],
  );

  const dismissAlternatives = useCallback(() => setAlternatives(null), []);

  const cancel = useCallback(
    (itemId: string) => {
      controllers.current.get(itemId)?.abort();
      controllers.current.delete(itemId);
      setItemPending(itemId, null);
    },
    [setItemPending],
  );

  return {
    pending,
    alternatives,
    start,
    applyOption,
    dismissAlternatives,
    cancel,
  };
}
