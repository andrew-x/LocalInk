"use client";

import { useFocusBundleOp } from "@/components/studio/workspace/use-studio-store";
import { cn } from "@/lib/util";

import type { ProposedPlanItem } from "./use-bundle-preview";

const KIND_LABEL = { chapter: "chapter", scene: "scene", moment: "moment" };

type ProposedPlanRowProps = {
  depth: number;
  item: ProposedPlanItem;
};

/**
 * A plan.create op shown in place in the tree. It is not a plan item yet, so
 * it cannot be selected or edited; clicking it opens its op in the chat's
 * review card.
 */
export function ProposedPlanRow({ depth, item }: ProposedPlanRowProps) {
  const focusBundleOp = useFocusBundleOp();
  const title = item.title.trim() || `Untitled ${KIND_LABEL[item.kind]}`;
  return (
    <div className="relative" style={{ paddingLeft: `${depth * 0.875}rem` }}>
      <button
        aria-disabled="true"
        aria-level={depth + 1}
        aria-selected={false}
        aria-label={`Proposed ${item.kind}: ${title}. Review in chat`}
        className={cn(
          "my-0.5 flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-md border border-studio-proposed/60 border-dashed px-1.5 text-left text-label-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40",
        )}
        data-proposed-plan-row={item.tempId}
        onClick={() =>
          focusBundleOp({ bundleId: item.bundleId, opId: item.opId })
        }
        role="treeitem"
        type="button"
      >
        <span
          aria-hidden="true"
          className="ml-5 size-2 shrink-0 rounded-full border border-studio-proposed border-dashed"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            item.kind === "chapter" && "font-semibold",
            !item.title.trim() && "italic",
          )}
        >
          {title}
        </span>
        <span className="shrink-0 rounded-full border border-studio-proposed/50 px-1.5 py-px text-caption text-studio-proposed leading-4">
          Proposed
        </span>
      </button>
    </div>
  );
}
