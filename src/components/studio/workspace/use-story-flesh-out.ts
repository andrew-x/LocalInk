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
import {
  STUDIO_PLAN_STORY_TARGET,
  type StudioPlanPreview,
} from "@/lib/studio/planning-contract";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

const PLAN_FAILED_MESSAGE =
  "Scenes could not be planned for the chapters. Please try again.";
const APPLY_FAILED_MESSAGE =
  "The planned scenes could not be saved. Please try again.";

export type StoryFleshOut = {
  /** Some chapter has no scenes yet, so there is something to plan. */
  canPlan: boolean;
  /** Planning can be cancelled; once applying, the server is committing. */
  phase: "idle" | "planning" | "applying";
  start: () => void;
  cancel: () => void;
};

const StoryFleshOutContext = createContext<StoryFleshOut | null>(null);

/**
 * "Plan scenes for every chapter": the plan route's story-wide flesh-out,
 * then apply and replace the workspace. One request per workspace, shared by
 * the outline's "Plan scenes for N chapters" line and the manuscript's empty
 * state.
 */
export function StoryFleshOutProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const controllerRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<StoryFleshOut["phase"]>("idle");

  const canPlan = useMemo(() => {
    const parents = new Set(state.planItems.map((item) => item.parentId));
    return state.planItems.some(
      (item) => item.kind === "chapter" && !parents.has(item.id),
    );
  }, [state.planItems]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const start = useCallback(() => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("planning");

    void (async () => {
      try {
        const preview = await postStudioJson<StudioPlanPreview>(
          "/api/studio/plan",
          {
            mode: "flesh-out",
            storyId,
            targetItemId: STUDIO_PLAN_STORY_TARGET,
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setPhase("applying");
        const workspace = await run(
          applyStudioPlan({
            storyId,
            generationId: preview.generationId,
            mode: "flesh-out",
            targetItemId: STUDIO_PLAN_STORY_TARGET,
          }),
          APPLY_FAILED_MESSAGE,
        );
        // The server committed, so the store follows.
        if (workspace) dispatch({ type: "replace", workspace });
      } catch (error) {
        if (controller.signal.aborted) return;
        toast.error(studioErrorMessage(error, PLAN_FAILED_MESSAGE));
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setPhase("idle");
        }
      }
    })();
  }, [dispatch, run, storyId]);

  const cancel = useCallback(() => {
    // Applying is already committing on the server; let it land.
    if (phase !== "planning") return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase("idle");
  }, [phase]);

  const value = useMemo<StoryFleshOut>(
    () => ({ canPlan, phase, start, cancel }),
    [canPlan, cancel, phase, start],
  );
  return createElement(StoryFleshOutContext.Provider, { value }, children);
}

export function useStoryFleshOut(): StoryFleshOut {
  const value = useContext(StoryFleshOutContext);
  if (!value) {
    throw new Error(
      "useStoryFleshOut must be used inside StoryFleshOutProvider.",
    );
  }
  return value;
}
