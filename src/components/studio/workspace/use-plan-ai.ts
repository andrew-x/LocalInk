"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { applyStudioPlan } from "@/actions/studio/apply-studio-plan";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import type { StudioPlanPreview } from "@/lib/studio/planning-contract";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

export type PlanAiPending = {
  /** Planning can be cancelled; once applying, the server is committing. */
  phase: "planning" | "applying";
};

export type PlanAiController = {
  pending: ReadonlyMap<string, PlanAiPending>;
  /** Plans a chapter's scenes or a scene's beats, then applies them. */
  fleshOut: (itemId: string) => Promise<void>;
  cancel: (itemId: string) => void;
};

const AI_REQUEST_FAILED_MESSAGE = "The AI request failed. Please try again.";
const APPLY_FAILED_MESSAGE = "The plan could not be saved. Please try again.";

const PlanAiContext = createContext<PlanAiController | null>(null);

/**
 * Per-item flesh-out (plan route, then apply and replace the workspace). One
 * provider per workspace, so every caller sees the same pending runs and a
 * second request for an item already being planned is ignored.
 *
 * Applying replaces the workspace while the author may be typing in the
 * outline. That is safe because flesh-out only adds children, and autosaved
 * fields the author has edited ignore store values until their save lands.
 */
export function PlanAiProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const controllers = useRef(new Map<string, AbortController>());
  const [pending, setPending] = useState<Map<string, PlanAiPending>>(
    () => new Map(),
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

  const fleshOut = useCallback(
    async (itemId: string) => {
      if (controllers.current.has(itemId)) return;
      const controller = new AbortController();
      controllers.current.set(itemId, controller);
      setItemPending(itemId, { phase: "planning" });

      try {
        const preview = await postStudioJson<StudioPlanPreview>(
          "/api/studio/plan",
          { mode: "flesh-out", storyId, targetItemId: itemId },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setItemPending(itemId, { phase: "applying" });
        const workspace = await run(
          applyStudioPlan({
            storyId,
            generationId: preview.generationId,
            mode: "flesh-out",
            targetItemId: itemId,
          }),
          APPLY_FAILED_MESSAGE,
        );
        // The server committed, so the store follows.
        if (workspace) dispatch({ type: "replace", workspace });
      } catch (error) {
        if (controller.signal.aborted) return;
        // Only the route's own sanitized messages are shown verbatim.
        toast.error(studioErrorMessage(error, AI_REQUEST_FAILED_MESSAGE));
      } finally {
        // A cancelled run was already cleared; never clear a newer run.
        if (controllers.current.get(itemId) === controller) {
          controllers.current.delete(itemId);
          setItemPending(itemId, null);
        }
      }
    },
    [dispatch, run, setItemPending, storyId],
  );

  const cancel = useCallback(
    (itemId: string) => {
      // Applying is already committing on the server; let it land.
      if (pending.get(itemId)?.phase !== "planning") return;
      controllers.current.get(itemId)?.abort();
      controllers.current.delete(itemId);
      setItemPending(itemId, null);
    },
    [pending, setItemPending],
  );

  const value = useMemo<PlanAiController>(
    () => ({ pending, fleshOut, cancel }),
    [cancel, fleshOut, pending],
  );
  return createElement(PlanAiContext.Provider, { value }, children);
}

export function usePlanAi(): PlanAiController {
  const value = useContext(PlanAiContext);
  if (!value) {
    throw new Error("usePlanAi must be used inside PlanAiProvider.");
  }
  return value;
}
