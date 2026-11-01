"use client";

import { useMemo } from "react";

import { buildPlanTree } from "@/lib/studio/plan-order";
import { cn } from "@/lib/util";

import type { StudioPlanStatus } from "./plan-status";
import { usePlanStatuses, useStudioStore } from "./use-studio-store";
import { scrollToStudioItem } from "./workspace-anchors";

const DEFAULT_TENSION = 5;

const SEGMENT_CLASS: Record<StudioPlanStatus, string> = {
  written: "bg-studio-status-written",
  planned: "bg-studio-status-planned",
  flagged: "bg-studio-status-flagged",
};

export function ArcStrip() {
  const { state, dispatch } = useStudioStore();
  const statuses = usePlanStatuses();
  const chapters = useMemo(
    () => buildPlanTree(state.planItems).filter((n) => n.kind === "chapter"),
    [state.planItems],
  );

  if (chapters.length === 0) return <div className="min-w-16 flex-1" />;

  return (
    <fieldset
      aria-label="Story arc"
      className="m-0 flex h-6 min-w-16 flex-1 items-end gap-0.5 border-0 p-0"
    >
      {chapters.map((chapter, index) => {
        const status = statuses.get(chapter.id) ?? "planned";
        const tension = chapter.tension ?? DEFAULT_TENSION;
        const isSelected = state.selectedItemId === chapter.id;
        return (
          <button
            aria-label={`Chapter ${index + 1}, tension ${tension}, ${status}`}
            aria-pressed={isSelected}
            className={cn(
              "min-w-1 flex-1 rounded-t-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring",
              SEGMENT_CLASS[status],
              isSelected && "opacity-100",
            )}
            key={chapter.id}
            onClick={() => {
              dispatch({ type: "select", itemId: chapter.id });
              scrollToStudioItem(chapter.id, true);
            }}
            style={{ height: `${tension * 10}%` }}
            title={chapter.title.trim() || `Chapter ${index + 1}`}
            type="button"
          />
        );
      })}
    </fieldset>
  );
}
