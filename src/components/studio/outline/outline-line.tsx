"use client";

import { ChevronRight } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePlanTreeActions } from "@/components/studio/workspace/use-plan-tree-actions";
import { studioOutlineLineId } from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { PLAN_ITEM_PLACEHOLDER, planItemLabel } from "@/lib/studio/plan-labels";
import { cn } from "@/lib/util";

import { type OutlineStatus, useOutlineView } from "./use-outline-view";

const STATUS_LABEL: Record<OutlineStatus, string> = {
  written: "Written",
  drafting: "Being written",
  planned: "Planned",
  flagged: "Has something to check",
};

/** Filled = written, spinning = being written, hollow = planned, amber = flagged. */
export function StatusDot({ status }: { status: OutlineStatus }) {
  return (
    <span
      aria-label={STATUS_LABEL[status]}
      className={cn(
        "shrink-0 rounded-full",
        status === "written" && "size-[7px] bg-studio-status-written",
        status === "planned" &&
          "size-[7px] border-[1.5px] border-studio-status-planned",
        status === "flagged" && "size-[7px] bg-studio-status-flagged",
        status === "drafting" &&
          "size-[9px] animate-spin border-2 border-studio-status-written border-r-transparent",
      )}
      role="img"
    />
  );
}

type OutlineLineProps = {
  item: StudioPlanItemDto;
  status: OutlineStatus;
  isOpen: boolean;
  isReading: boolean;
  onOpen: () => void;
  /** Revealed on hover or focus, e.g. Plan scenes and ⋯. */
  actions?: ReactNode;
  /** Small pills such as "1 to check". */
  tags?: ReactNode;
  /** Chapters only. */
  number?: number;
  /** Chapters only. */
  wordCount?: number;
};

/**
 * One ~28px outline line: chevron and number (chapters), status dot, title,
 * the start of the description, word count (chapters), tags and actions.
 * Keyboard navigation and dragging are handled by the outline around it.
 */
export function OutlineLine({
  actions,
  isOpen,
  isReading,
  item,
  number,
  onOpen,
  status,
  tags,
  wordCount,
}: OutlineLineProps) {
  const { drop, draggingId, renamingId, tabStopId } = useOutlineView();
  const isChapter = item.kind === "chapter";
  const renaming = renamingId === item.id;
  const hint = drop?.targetId === item.id ? drop.hint : null;
  const title = item.title.trim();
  const description = item.whatHappens.trim();

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    // Clicks from the actions, including their portaled menus, are theirs.
    const target = event.target;
    if (
      !(target instanceof Element) ||
      !event.currentTarget.contains(target) ||
      target.closest("[data-line-actions]")
    ) {
      return;
    }
    onOpen();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div className="relative">
      {hint === "before" ? (
        <div className="absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary" />
      ) : null}
      {hint === "after" ? (
        <div className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
      ) : null}
      <div
        aria-expanded={isOpen}
        aria-label={`${number !== undefined ? `Chapter ${number}: ` : ""}${planItemLabel(item)} (${STATUS_LABEL[status].toLowerCase()})`}
        aria-level={isChapter ? 1 : 2}
        className={cn(
          "group/line flex h-7 min-w-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-md px-2 font-normal text-label-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40",
          isReading && "shadow-[inset_2px_0_0_var(--color-primary)]",
          draggingId === item.id && "opacity-40",
          hint === "inside" && "ring-1 ring-primary",
        )}
        data-outline-line={item.id}
        draggable={!renaming}
        id={studioOutlineLineId(item.id)}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={tabStopId === item.id ? 0 : -1}
      >
        {isChapter ? (
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 shrink-0 text-muted-foreground/70 transition-transform",
              isOpen && "rotate-90",
            )}
          />
        ) : null}
        <StatusDot status={status} />
        {number !== undefined ? (
          <span className="w-4 shrink-0 text-caption text-muted-foreground/80 tabular-nums">
            {number}
          </span>
        ) : null}
        {renaming ? (
          <RenameInput item={item} />
        ) : title ? (
          <span
            className={cn(
              "max-w-[70%] shrink-0 truncate",
              isChapter ? "font-semibold" : "font-medium",
              status === "planned" && !isChapter && "text-muted-foreground",
            )}
          >
            {title}
          </span>
        ) : (
          // Titles are optional: the description stands in for one.
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              isChapter ? "font-semibold" : "font-medium",
              !description && "text-muted-foreground italic",
              status === "planned" && !isChapter && "text-muted-foreground",
            )}
          >
            {/* An open chapter shows its whole description below the line. */}
            {isChapter && isOpen
              ? ""
              : description || PLAN_ITEM_PLACEHOLDER[item.kind]}
          </span>
        )}
        {renaming || title ? (
          <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/80">
            {/* An open chapter shows its whole description below the line. */}
            {renaming || (isChapter && isOpen) ? "" : item.whatHappens}
          </span>
        ) : null}
        {wordCount ? (
          <span className="shrink-0 text-caption text-muted-foreground/80 tabular-nums">
            {wordCount.toLocaleString()}
          </span>
        ) : null}
        {tags}
        {actions ? (
          <span
            className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/line:opacity-100 group-focus-visible/line:opacity-100"
            data-line-actions
          >
            {actions}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RenameInput({ item }: { item: StudioPlanItemDto }) {
  const { setRenamingId } = useOutlineView();
  const { rename } = usePlanTreeActions();
  const [draft, setDraft] = useState(item.title);
  const skipCommit = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function finish(commit: boolean) {
    if (!commit) skipCommit.current = true;
    setRenamingId(null);
    // Back to the line, so arrow keys keep working.
    requestAnimationFrame(() =>
      document.getElementById(studioOutlineLineId(item.id))?.focus(),
    );
  }

  return (
    <input
      aria-label={`Rename ${item.kind}`}
      className="h-5 min-w-0 flex-1 rounded-sm border border-input bg-card px-1 font-semibold text-label-sm outline-none focus-visible:border-ring"
      maxLength={200}
      onBlur={() => {
        if (!skipCommit.current) void rename(item, draft);
        setRenamingId(null);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          void rename(item, draft);
          skipCommit.current = true;
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
      ref={inputRef}
      value={draft}
    />
  );
}
