"use client";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { PLAN_ITEM_PLACEHOLDER } from "@/lib/studio/plan-labels";

import { useWritingLoop } from "./use-writing-loop";

const DESCRIPTION_CHARS = 90;

function descriptionStart(description: string): string {
  const text = description.replace(/\s+/g, " ").trim();
  if (text.length <= DESCRIPTION_CHARS) return text;
  return `${text.slice(0, DESCRIPTION_CHARS).trimEnd()}…`;
}

/** The quiet closing line: the next scene to write, with a Write button. */
export function UpNext({ sceneId }: { sceneId: string }) {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const scene = state.planItems.find((item) => item.id === sceneId);
  if (!scene) return null;
  const title = scene.title.trim();
  const start = descriptionStart(scene.whatHappens);

  return (
    <p className="flex flex-wrap items-baseline justify-center gap-x-2 text-center font-sans text-caption text-muted-foreground">
      <span>
        Up next:{" "}
        <span className="text-foreground/80">
          {title || start || PLAN_ITEM_PLACEHOLDER.scene}
        </span>
        {title && start ? `, ${start}` : null}
      </span>
      <button
        className="rounded-sm px-1.5 py-0.5 text-studio-proposed underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={loop.isKeeping}
        onClick={() => void loop.writeScene(sceneId)}
        type="button"
      >
        Write it ▸
      </button>
    </p>
  );
}
