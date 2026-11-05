"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/common/button";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { planItemLabel } from "@/lib/studio/plan-labels";

import { useWritingLoop } from "./use-writing-loop";

/**
 * Floats at the bottom of the manuscript while a scene is planned or written
 * ("Writing *Deep end* · beat 2 of 4", with Stop), and while Keep saves and
 * re-reads it.
 */
export function WritingStatus() {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const draft = loop.draft;
  const running = draft?.status === "planning" || draft?.status === "streaming";
  if (!running && !loop.isKeeping) return null;

  const scene = draft
    ? state.planItems.find((item) => item.id === draft.sceneId)
    : undefined;
  const title = (
    <span className="text-foreground italic">
      {scene ? planItemLabel(scene, 40) : "this scene"}
    </span>
  );
  const current = draft
    ? draft.beats.findIndex((beat) => beat.status === "streaming")
    : -1;

  let message: ReactNode;
  if (!running) {
    message = "Keeping the scene…";
  } else if (draft?.status === "planning") {
    message = <>Planning {title}…</>;
  } else {
    message = (
      <>
        Writing {title}
        {current >= 0 ? ` · beat ${current + 1} of ${draft?.beats.length}` : ""}
      </>
    );
  }

  return (
    <div className="pointer-events-none sticky bottom-6 z-10 mt-10 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-studio-proposed/40 bg-card/95 py-1 pr-1.5 pl-4 font-sans text-caption text-muted-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-studio-proposed motion-safe:animate-pulse"
        />
        <output aria-live="polite">{message}</output>
        {running ? (
          <Button
            className="h-7 rounded-full px-3"
            onClick={loop.stop}
            size="sm"
            type="button"
            variant="ghost"
          >
            Stop
          </Button>
        ) : (
          <span className="w-1.5" />
        )}
      </div>
    </div>
  );
}
