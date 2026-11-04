"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { createStudioPlanItem } from "@/actions/studio/create-studio-plan-item";
import { deleteStudioPlanItem } from "@/actions/studio/delete-studio-plan-item";
import { moveStudioPlanItem } from "@/actions/studio/move-studio-plan-item";
import { restoreStudioPlanItem } from "@/actions/studio/restore-studio-plan-item";
import { usePatchPlanItem } from "@/components/studio/shared/use-patch-plan-item";
import type { StudioPlanItemDto, StudioPlanKind } from "@/lib/studio/contracts";
import { buildPlanTree } from "@/lib/studio/plan-order";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

const PARENT_KIND: Record<StudioPlanKind, StudioPlanKind | null> = {
  chapter: null,
  scene: "chapter",
  moment: "scene",
};

// Moments are "beats" everywhere the author sees them.
const KIND_LABEL: Record<StudioPlanKind, string> = {
  chapter: "chapter",
  scene: "scene",
  moment: "beat",
};

const CHILD_KIND: Record<StudioPlanKind, StudioPlanKind | null> = {
  chapter: "scene",
  scene: "moment",
  moment: null,
};

export type PlanDropHint = "before" | "after" | "inside";

export type PlanDropTarget = {
  parentId: string | null;
  index: number;
  hint: PlanDropHint;
};

function orderedChildIds(
  items: StudioPlanItemDto[],
  parentId: string | null,
): string[] {
  const tree = buildPlanTree(items);
  if (parentId === null) return tree.map((node) => node.id);
  const find = (nodes: typeof tree): string[] | null => {
    for (const node of nodes) {
      if (node.id === parentId) return node.children.map((c) => c.id);
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  return find(tree) ?? [];
}

/**
 * Where a dragged item lands when dropped on `target`. Only drops whose
 * resulting parent kind is valid resolve; everything else returns null.
 * `upperHalf` is whether the pointer is over the top half of the target row.
 */
export function resolvePlanDrop(
  items: StudioPlanItemDto[],
  dragged: StudioPlanItemDto,
  target: StudioPlanItemDto,
  upperHalf: boolean,
): PlanDropTarget | null {
  if (dragged.id === target.id) return null;

  if (target.kind === dragged.kind) {
    const siblings = orderedChildIds(items, target.parentId).filter(
      (id) => id !== dragged.id,
    );
    const at = siblings.indexOf(target.id);
    if (at === -1) return null;
    return {
      parentId: target.parentId,
      index: upperHalf ? at : at + 1,
      hint: upperHalf ? "before" : "after",
    };
  }

  if (target.kind === PARENT_KIND[dragged.kind]) {
    const children = orderedChildIds(items, target.id).filter(
      (id) => id !== dragged.id,
    );
    return { parentId: target.id, index: children.length, hint: "inside" };
  }
  return null;
}

export function usePlanTreeActions() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const patchItem = usePatchPlanItem();
  const storyId = state.story.id;

  const rename = useCallback(
    async (item: StudioPlanItemDto, title: string) => {
      const next = title.trim();
      if (next === item.title) return;
      // Shares the per-item save queue with the outline's autosave; a conflict
      // toasts the server message and the local title stays.
      await patchItem(item.id, { title: next });
    },
    [patchItem],
  );

  const create = useCallback(
    async (input: {
      kind: StudioPlanKind;
      parentId: string | null;
      afterItemId?: string | null;
    }): Promise<StudioPlanItemDto | null> => {
      const result = await run(
        createStudioPlanItem({ storyId, ...input }),
        "The item could not be added.",
      );
      if (!result) return null;
      dispatch({
        type: "merge",
        planItems: [result.item, ...result.shifted],
      });
      dispatch({ type: "select", itemId: result.item.id });
      return result.item;
    },
    [dispatch, run, storyId],
  );

  /**
   * Chapters/scenes get a child at the end; moments get a sibling after
   * themselves. Resolves the new item, or null after a toast.
   */
  const add = useCallback(
    (item: StudioPlanItemDto): Promise<StudioPlanItemDto | null> => {
      const childKind = CHILD_KIND[item.kind];
      if (childKind) {
        return create({ kind: childKind, parentId: item.id });
      }
      return create({
        kind: item.kind,
        parentId: item.parentId,
        afterItemId: item.id,
      });
    },
    [create],
  );

  const addChapter = useCallback(
    () => create({ kind: "chapter", parentId: null }),
    [create],
  );

  const remove = useCallback(
    async (item: StudioPlanItemDto) => {
      const result = await run(
        deleteStudioPlanItem({ storyId, itemId: item.id }),
        "The item could not be deleted.",
      );
      if (!result) return;
      dispatch({ type: "remove", planItemIds: result.deletedIds });
      toast(`Deleted ${KIND_LABEL[item.kind]}.`, {
        action: {
          label: "Undo",
          onClick: () => {
            void (async () => {
              // An expired undo toasts the server's own message.
              const workspace = await run(
                restoreStudioPlanItem({
                  storyId,
                  undoToken: result.undoToken,
                }),
                "The item could not be restored.",
              );
              if (workspace) dispatch({ type: "replace", workspace });
            })();
          },
        },
        duration: 10_000,
      });
    },
    [dispatch, run, storyId],
  );

  const move = useCallback(
    async (item: StudioPlanItemDto, drop: PlanDropTarget) => {
      const changed = await run(
        moveStudioPlanItem({
          storyId,
          itemId: item.id,
          newParentId: drop.parentId,
          newIndex: drop.index,
        }),
        "The item could not be moved.",
      );
      if (changed) dispatch({ type: "merge", planItems: changed });
    },
    [dispatch, run, storyId],
  );

  return { add, addChapter, move, remove, rename };
}
