"use client";

import { useMemo } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  isStudioBundleTempRef,
  type StudioBundleDto,
  type StudioBundleOpDto,
} from "@/lib/studio/bundle-contract";
import type { StudioPlanKind } from "@/lib/studio/contracts";

/** A plan.create op, shaped for rendering as a proposed tree row. */
export type ProposedPlanItem = {
  /** The pending bundle the op belongs to (op ids repeat across bundles). */
  bundleId: string;
  opId: string;
  /** The op's temp id; it doubles as the row's key and collapse id. */
  tempId: string;
  label: string;
  kind: StudioPlanKind;
  title: string;
  whatHappens: string;
  /** A saved plan item id, a temp id of another proposed item, or null (chapter). */
  parentRef: string | null;
  /** The sibling it follows (saved or temp id), or null to append. */
  afterRef: string | null;
};

export type BundlePreview = {
  /** The most recent pending bundle; only that one previews in place. */
  pending: StudioBundleDto | null;
  proposedPlanItems: ProposedPlanItem[];
  /** Saved plan items that a pending op edits, moves, deletes, or writes in. */
  changedItemIds: Set<string>;
  /** Saved moment id to its pending prose op. */
  proseOpByMomentId: Map<string, StudioBundleOpDto>;
  opsForItem(itemId: string): StudioBundleOpDto[];
};

/** The saved plan items a pending op touches (temp refs excluded). */
function touchedItemIds(op: StudioBundleOpDto): string[] {
  switch (op.kind) {
    case "plan.update":
    case "plan.move":
    case "plan.delete":
      return [op.itemId];
    case "prose.write":
      return [op.momentRef];
    case "change.create":
      return [op.planItemRef];
    case "change.update":
    case "change.delete":
      return [op.baseline.planItemId];
    default:
      return [];
  }
}

/** Derived from the most recent pending bundle only. */
export function useBundlePreview(): BundlePreview {
  const { state } = useStudioStore();
  const bundles = state.bundles;
  return useMemo(() => {
    const pending =
      [...bundles].reverse().find((bundle) => bundle.status === "pending") ??
      null;
    const proposedPlanItems: ProposedPlanItem[] = [];
    const opsByItem = new Map<string, StudioBundleOpDto[]>();
    const proseOpByMomentId = new Map<string, StudioBundleOpDto>();
    for (const op of pending?.operations ?? []) {
      if (op.status !== "pending") continue;
      if (pending && op.kind === "plan.create") {
        proposedPlanItems.push({
          bundleId: pending.id,
          opId: op.id,
          tempId: op.tempId,
          label: op.label,
          kind: op.item.kind,
          title: op.item.title,
          whatHappens: op.item.whatHappens,
          parentRef: op.item.parentRef,
          afterRef: op.item.afterRef,
        });
      }
      if (op.kind === "prose.write" && !isStudioBundleTempRef(op.momentRef)) {
        proseOpByMomentId.set(op.momentRef, op);
      }
      for (const itemId of touchedItemIds(op)) {
        if (isStudioBundleTempRef(itemId)) continue;
        const list = opsByItem.get(itemId) ?? [];
        list.push(op);
        opsByItem.set(itemId, list);
      }
    }
    return {
      pending,
      proposedPlanItems,
      changedItemIds: new Set(opsByItem.keys()),
      proseOpByMomentId,
      opsForItem: (itemId: string) => opsByItem.get(itemId) ?? [],
    };
  }, [bundles]);
}
