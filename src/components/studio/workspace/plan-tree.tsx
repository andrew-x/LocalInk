"use client";

import { Plus } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/common/button";
import { ProposedPlanRow } from "@/components/studio/bundles/proposed-plan-row";
import {
  type ProposedPlanItem,
  useBundlePreview,
} from "@/components/studio/bundles/use-bundle-preview";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import {
  buildPlanTree,
  getAncestors,
  type StudioPlanNode,
} from "@/lib/studio/plan-order";

import { PlanTreeItem } from "./plan-tree-item";
import { usePlanAi } from "./use-plan-ai";
import {
  type PlanDropTarget,
  resolvePlanDrop,
  usePlanTreeActions,
} from "./use-plan-tree-actions";
import { useStoryFleshOut } from "./use-story-flesh-out";
import { usePlanStatuses, useStudioStore } from "./use-studio-store";
import { scrollToStudioItem, studioPlanRowId } from "./workspace-anchors";

type PlanTreeProps = {
  /** Wired by the manuscript's writing loop; hides "Write" if absent. */
  onWrite?: (itemId: string) => void;
  /** Chains drafts through a scene's unwritten moments. */
  onWriteRestOfScene?: (itemId: string, autoKeep: boolean) => void;
};

type VisibleRow = {
  /** The tree key: a plan item id, or a proposed item's temp id. */
  id: string;
  /** Null for a proposed row, which is not a plan item yet. */
  node: StudioPlanNode | null;
  proposed: ProposedPlanItem | null;
  depth: number;
  hasChildren: boolean;
};

type TreeEntry =
  | { real: StudioPlanNode; proposed?: undefined }
  | { proposed: ProposedPlanItem; real?: undefined };

/**
 * The siblings under one parent: saved children in order, with proposed
 * creates slotted in after the sibling they name (or appended).
 */
function siblingEntries(
  parentRef: string | null,
  saved: StudioPlanNode[],
  proposed: ProposedPlanItem[],
): TreeEntry[] {
  const list: TreeEntry[] = saved.map((real) => ({ real }));
  let waiting = proposed.filter((item) => item.parentRef === parentRef);
  while (waiting.length > 0) {
    const rest: ProposedPlanItem[] = [];
    let progressed = false;
    for (const item of waiting) {
      if (item.afterRef === null) {
        list.push({ proposed: item });
        progressed = true;
        continue;
      }
      const at = list.findIndex(
        (entry) =>
          (entry.real ? entry.real.id : entry.proposed.tempId) ===
          item.afterRef,
      );
      if (at === -1) {
        rest.push(item);
        continue;
      }
      list.splice(at + 1, 0, { proposed: item });
      progressed = true;
    }
    if (!progressed) {
      for (const item of rest) list.push({ proposed: item });
      break;
    }
    waiting = rest;
  }
  return list;
}

function collectVisible(
  parentRef: string | null,
  nodes: StudioPlanNode[],
  collapsed: Set<string>,
  proposed: ProposedPlanItem[],
  depth = 0,
  rows: VisibleRow[] = [],
): VisibleRow[] {
  for (const entry of siblingEntries(parentRef, nodes, proposed)) {
    if (entry.real) {
      const node = entry.real;
      rows.push({
        id: node.id,
        node,
        proposed: null,
        depth,
        hasChildren:
          node.children.length > 0 ||
          proposed.some((item) => item.parentRef === node.id),
      });
      if (!collapsed.has(node.id)) {
        collectVisible(
          node.id,
          node.children,
          collapsed,
          proposed,
          depth + 1,
          rows,
        );
      }
    } else {
      const item = entry.proposed;
      rows.push({
        id: item.tempId,
        node: null,
        proposed: item,
        depth,
        hasChildren: false,
      });
      collectVisible(item.tempId, [], collapsed, proposed, depth + 1, rows);
    }
  }
  return rows;
}

export function PlanTree({ onWrite, onWriteRestOfScene }: PlanTreeProps) {
  const { state, dispatch } = useStudioStore();
  const statuses = usePlanStatuses();
  const ai = usePlanAi();
  const storyPlan = useStoryFleshOut();
  const actions = usePlanTreeActions();
  const preview = useBundlePreview();
  const { changedItemIds, proposedPlanItems } = preview;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dragged, setDragged] = useState<StudioPlanItemDto | null>(null);
  const [drop, setDrop] = useState<
    (PlanDropTarget & { targetId: string }) | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<StudioPlanItemDto | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const { planItems, selectedItemId } = state;
  const tree = useMemo(() => buildPlanTree(planItems), [planItems]);
  const rows = useMemo(
    () => collectVisible(null, tree, collapsed, proposedPlanItems),
    [tree, collapsed, proposedPlanItems],
  );
  // Proposed rows are previews: keyboard navigation skips them.
  const selectableRows = useMemo(
    () => rows.filter((row) => row.node !== null),
    [rows],
  );

  // Keep one row tabbable even when nothing visible is selected.
  const tabStopId = selectableRows.some((row) => row.id === selectedItemId)
    ? selectedItemId
    : (selectableRows[0]?.id ?? null);

  // A selection made elsewhere (arc strip, manuscript) must be visible here.
  useEffect(() => {
    if (!selectedItemId) return;
    const ancestorIds = getAncestors(planItems, selectedItemId).map(
      (a) => a.id,
    );
    setCollapsed((current) => {
      if (!ancestorIds.some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestorIds) next.delete(id);
      return next;
    });
  }, [selectedItemId, planItems]);

  useEffect(() => {
    if (selectedItemId) scrollToStudioItem(selectedItemId);
  }, [selectedItemId]);

  function toggle(itemId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
    ) {
      return;
    }
    if (selectableRows.length === 0) return;
    event.preventDefault();
    const current = selectableRows.findIndex(
      (row) => row.id === selectedItemId,
    );
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next =
      current === -1
        ? delta > 0
          ? 0
          : selectableRows.length - 1
        : Math.min(selectableRows.length - 1, Math.max(0, current + delta));
    const nextId = selectableRows[next].id;
    dispatch({ type: "select", itemId: nextId });
    document.getElementById(studioPlanRowId(nextId))?.focus();
  }

  function handleDragOver(event: DragEvent, target: StudioPlanItemDto) {
    if (!dragged) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const upperHalf = event.clientY < bounds.top + bounds.height / 2;
    const resolved = resolvePlanDrop(planItems, dragged, target, upperHalf);
    if (!resolved) {
      setDrop(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrop((current) =>
      current?.targetId === target.id &&
      current.hint === resolved.hint &&
      current.index === resolved.index
        ? current
        : { ...resolved, targetId: target.id },
    );
  }

  function handleDrop(event: DragEvent, target: StudioPlanItemDto) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const upperHalf = event.clientY < bounds.top + bounds.height / 2;
    const item = dragged;
    setDragged(null);
    setDrop(null);
    if (!item) return;
    const resolved = resolvePlanDrop(planItems, item, target, upperHalf);
    if (resolved) void actions.move(item, resolved);
  }

  async function confirmDelete() {
    const item = pendingDelete;
    if (!item) return;
    setIsDeleting(true);
    try {
      await actions.remove(item);
    } finally {
      setIsDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <h2 className="text-caption text-muted-foreground uppercase tracking-wider">
          Plan
        </h2>
        <div className="flex items-center gap-1">
          {storyPlan.phase !== "idle" ? (
            <Button
              aria-label={
                storyPlan.phase === "planning"
                  ? "Cancel planning scenes for every chapter"
                  : "Saving planned scenes"
              }
              disabled={storyPlan.phase !== "planning"}
              loading
              onClick={storyPlan.cancel}
              size="sm"
              tooltip={
                storyPlan.phase === "planning"
                  ? "Planning scenes… click to cancel"
                  : "Saving planned scenes…"
              }
              type="button"
              variant="ghost"
            />
          ) : storyPlan.canPlan ? (
            <Button
              aria-label="Plan scenes for every chapter"
              className="text-muted-foreground"
              onClick={storyPlan.start}
              size="sm"
              tooltip="Plan scenes for every chapter that has none"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true">✦</span>
            </Button>
          ) : null}
          <Button
            aria-label="Add chapter"
            onClick={() => void actions.addChapter()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Chapter
          </Button>
        </div>
      </div>
      <div
        aria-label="Story plan"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        onKeyDown={handleKeyDown}
        role="tree"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-4 text-caption text-muted-foreground">
            No chapters yet. Add one to start planning.
          </p>
        ) : null}
        {rows.map(({ node, proposed, depth, hasChildren }) =>
          node === null ? (
            proposed ? (
              <ProposedPlanRow
                depth={depth}
                item={proposed}
                key={proposed.tempId}
              />
            ) : null
          ) : (
            <PlanTreeItem
              ai={ai}
              depth={depth}
              dropHint={drop?.targetId === node.id ? drop.hint : null}
              expanded={!collapsed.has(node.id)}
              hasChanges={changedItemIds.has(node.id)}
              hasChildren={hasChildren}
              isDragging={dragged?.id === node.id}
              isSelected={selectedItemId === node.id}
              isTabStop={node.id === tabStopId}
              item={node}
              key={node.id}
              onAdd={(item) => void actions.add(item)}
              onDelete={setPendingDelete}
              onDragEnd={() => {
                setDragged(null);
                setDrop(null);
              }}
              onDragOverRow={handleDragOver}
              onDragStartRow={setDragged}
              onDropRow={handleDrop}
              onRename={(item, title) => void actions.rename(item, title)}
              onSelect={(itemId) => dispatch({ type: "select", itemId })}
              onToggle={toggle}
              onWrite={onWrite}
              onWriteRestOfScene={onWriteRestOfScene}
              status={statuses.get(node.id) ?? "planned"}
            />
          ),
        )}
      </div>

      <StudioConfirmDialog
        confirmLabel="Delete"
        description={`${
          pendingDelete?.kind === "moment"
            ? "Any prose written for this moment is deleted with it."
            : "Everything inside it is deleted too, including any prose already written."
        } You can undo right after.`}
        destructive
        loading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        open={pendingDelete !== null}
        title={`Delete this ${pendingDelete?.kind ?? "item"}?`}
      />
    </div>
  );
}
