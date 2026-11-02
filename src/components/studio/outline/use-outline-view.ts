"use client";

import { createContext, useContext } from "react";

import type { StudioPlanStatus } from "@/components/studio/workspace/plan-status";
import type { PlanDropTarget } from "@/components/studio/workspace/use-plan-tree-actions";
import type {
  StudioFlagDto,
  StudioPlanItemDto,
  StudioProseDto,
} from "@/lib/studio/contracts";
import { getAncestors } from "@/lib/studio/plan-order";

/** Line status: the stored status plus "drafting" while the loop writes. */
export type OutlineStatus = StudioPlanStatus | "drafting";

/**
 * Every focusable outline line carries this attribute, set to its item id
 * (written out as `data-outline-line` in the JSX).
 */
export const OUTLINE_LINE_ATTRIBUTE = "data-outline-line";
/** The premise line's key, in place of a plan item id. */
export const STORY_LINE_KEY = "story";

export type OutlineDrop = PlanDropTarget & { targetId: string };

export type OutlineView = {
  statuses: ReadonlyMap<string, OutlineStatus>;
  /** Open flags in each item's subtree. */
  openFlags: ReadonlyMap<string, number>;
  /** Saved words per chapter. */
  wordCounts: ReadonlyMap<string, number>;
  chapterNumbers: ReadonlyMap<string, number>;
  /** The reading moment and its scene and chapter. */
  readingIds: ReadonlySet<string>;
  /** The one line in the tab order (roving tabindex). */
  tabStopId: string | null;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  drop: OutlineDrop | null;
  draggingId: string | null;
};

export const OutlineViewContext = createContext<OutlineView | null>(null);

export function useOutlineView(): OutlineView {
  const value = useContext(OutlineViewContext);
  if (!value) {
    throw new Error("useOutlineView must be used inside the Outline.");
  }
  return value;
}

/** The item and its ancestors, or nothing for a missing id. */
function selfAndAncestors(
  items: StudioPlanItemDto[],
  itemId: string | null,
): string[] {
  if (!itemId || !items.some((item) => item.id === itemId)) return [];
  return [itemId, ...getAncestors(items, itemId).map((item) => item.id)];
}

/** Adds `amount` to the item and every ancestor. */
function addUp(
  totals: Map<string, number>,
  byId: Map<string, StudioPlanItemDto>,
  itemId: string,
  amount: number,
) {
  const seen = new Set<string>();
  let current = byId.get(itemId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    totals.set(current.id, (totals.get(current.id) ?? 0) + amount);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
}

/**
 * Per-line display data, computed once for the whole outline. A drafting
 * moment (or a scene whose beats are being planned to write) spins its
 * scene and chapter too.
 */
export function computeOutlineData({
  draftingIds,
  flags,
  items,
  prose,
  readingItemId,
  statuses,
}: {
  draftingIds: (string | null)[];
  flags: StudioFlagDto[];
  items: StudioPlanItemDto[];
  prose: StudioProseDto[];
  readingItemId: string | null;
  statuses: Map<string, StudioPlanStatus>;
}) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const lineStatuses = new Map<string, OutlineStatus>(statuses);
  for (const id of draftingIds) {
    for (const drafting of selfAndAncestors(items, id)) {
      lineStatuses.set(drafting, "drafting");
    }
  }
  const openFlags = new Map<string, number>();
  for (const flag of flags) {
    if (flag.status === "open") addUp(openFlags, byId, flag.planItemId, 1);
  }
  const wordCounts = new Map<string, number>();
  for (const entry of prose) {
    if (entry.wordCount > 0) {
      addUp(wordCounts, byId, entry.momentId, entry.wordCount);
    }
  }
  return {
    statuses: lineStatuses,
    openFlags,
    wordCounts,
    readingIds: new Set(selfAndAncestors(items, readingItemId)),
  };
}
