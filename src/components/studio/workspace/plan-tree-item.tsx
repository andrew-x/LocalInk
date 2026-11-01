"use client";

import { ChevronRight, LoaderCircle, Plus, X } from "lucide-react";
import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/common/button";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { AiActionsMenu } from "./ai-actions-menu";
import type { StudioPlanStatus } from "./plan-status";
import type { PlanAiController } from "./use-plan-ai";
import type { PlanDropHint } from "./use-plan-tree-actions";
import { studioPlanRowId } from "./workspace-anchors";

const STATUS_LABEL: Record<StudioPlanStatus, string> = {
  written: "Written",
  planned: "Planned",
  flagged: "Has open flags",
};

const STATUS_DOT_CLASS: Record<StudioPlanStatus, string> = {
  written: "bg-studio-status-written",
  planned: "border border-studio-status-planned",
  flagged: "bg-studio-status-flagged",
};

const KIND_LABEL = { chapter: "chapter", scene: "scene", moment: "moment" };

type PlanTreeItemProps = {
  ai: PlanAiController;
  depth: number;
  dropHint: PlanDropHint | null;
  expanded: boolean;
  hasChildren: boolean;
  isDragging: boolean;
  isSelected: boolean;
  isTabStop: boolean;
  item: StudioPlanItemDto;
  onAdd: (item: StudioPlanItemDto) => void;
  onDelete: (item: StudioPlanItemDto) => void;
  onDragEnd: () => void;
  onDragOverRow: (event: DragEvent, item: StudioPlanItemDto) => void;
  onDragStartRow: (item: StudioPlanItemDto) => void;
  onDropRow: (event: DragEvent, item: StudioPlanItemDto) => void;
  onRename: (item: StudioPlanItemDto, title: string) => void;
  onSelect: (itemId: string) => void;
  onToggle: (itemId: string) => void;
  status: StudioPlanStatus;
  onWrite?: (itemId: string) => void;
};

export function PlanTreeItem({
  ai,
  depth,
  dropHint,
  expanded,
  hasChildren,
  isDragging,
  isSelected,
  isTabStop,
  item,
  onAdd,
  onDelete,
  onDragEnd,
  onDragOverRow,
  onDragStartRow,
  onDropRow,
  onRename,
  onSelect,
  onToggle,
  onWrite,
  status,
}: PlanTreeItemProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const skipCommit = useRef(false);
  const renameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameInput.current?.focus();
  }, [renaming]);
  const pending = ai.pending.get(item.id);
  const displayTitle = item.title.trim() || `Untitled ${KIND_LABEL[item.kind]}`;

  function startRename() {
    setDraft(item.title);
    skipCommit.current = false;
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    if (skipCommit.current) return;
    onRename(item, draft);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "F2") {
      event.preventDefault();
      startRename();
    } else if (event.key === "ArrowRight" && hasChildren && !expanded) {
      event.preventDefault();
      onToggle(item.id);
    } else if (event.key === "ArrowLeft" && hasChildren && expanded) {
      event.preventDefault();
      onToggle(item.id);
    }
  }

  return (
    <div className="relative" style={{ paddingLeft: `${depth * 0.875}rem` }}>
      {dropHint === "before" ? (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      {dropHint === "after" ? (
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
      ) : null}
      <div
        aria-expanded={hasChildren ? expanded : undefined}
        aria-level={depth + 1}
        aria-selected={isSelected}
        className={cn(
          "group/row flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 text-label-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
          isSelected ? "bg-muted text-foreground" : "hover:bg-muted/50",
          isDragging && "opacity-40",
          dropHint === "inside" && "ring-1 ring-primary",
        )}
        draggable={!renaming}
        id={studioPlanRowId(item.id)}
        onClick={() => onSelect(item.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onSelect(item.id);
          setMenuOpen(true);
        }}
        onDoubleClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("button, input")
          )
            return;
          startRename();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOverRow(event, item)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          onDragStartRow(item);
        }}
        onDrop={(event) => onDropRow(event, item)}
        onKeyDown={handleRowKeyDown}
        role="treeitem"
        tabIndex={isTabStop ? 0 : -1}
      >
        <button
          aria-label={expanded ? "Collapse" : "Expand"}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground",
            !hasChildren && "invisible",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(item.id);
          }}
          tabIndex={-1}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
        <span
          aria-label={STATUS_LABEL[status]}
          className={cn(
            "size-2 shrink-0 rounded-full",
            STATUS_DOT_CLASS[status],
          )}
          role="img"
        />
        {renaming ? (
          <input
            aria-label={`Rename ${item.kind}`}
            ref={renameInput}
            className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 py-0.5 text-label-sm outline-none focus-visible:border-ring"
            maxLength={200}
            onBlur={commitRename}
            onChange={(event) => setDraft(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                skipCommit.current = true;
                setDraft(item.title);
                setRenaming(false);
              }
            }}
            value={draft}
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              item.kind === "chapter" && "font-semibold",
              !item.title.trim() && "text-muted-foreground italic",
            )}
          >
            {displayTitle}
          </span>
        )}
        {pending ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <LoaderCircle
              aria-label="AI working"
              className="size-3.5 animate-spin text-muted-foreground"
              role="img"
            />
            {pending.phase === "planning" ? (
              <Button
                aria-label="Cancel AI action"
                className="size-5"
                onClick={(event) => {
                  event.stopPropagation();
                  ai.cancel(item.id);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-3" />
              </Button>
            ) : null}
          </span>
        ) : null}
        <span className="flex shrink-0 items-center">
          <Button
            aria-label={
              item.kind === "moment"
                ? "Add moment after"
                : `Add inside ${item.kind}`
            }
            className="size-6 text-muted-foreground opacity-0 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onAdd(item);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </Button>
          <AiActionsMenu
            ai={ai}
            item={item}
            onDelete={onDelete}
            onOpenChange={setMenuOpen}
            onWrite={onWrite}
            open={menuOpen}
          />
        </span>
      </div>
      {isSelected && item.whatHappens.trim() ? (
        <p className="truncate pr-2 pb-1 pl-[3.25rem] text-caption text-muted-foreground">
          {item.whatHappens}
        </p>
      ) : null}
    </div>
  );
}
