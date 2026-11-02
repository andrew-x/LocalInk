"use client";

import { Plus } from "lucide-react";
import {
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/common/button";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import {
  resolvePlanDrop,
  usePlanTreeActions,
} from "@/components/studio/workspace/use-plan-tree-actions";
import { useStoryFleshOut } from "@/components/studio/workspace/use-story-flesh-out";
import {
  usePlanStatuses,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { studioOutlineLineId } from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { buildPlanTree, type StudioPlanNode } from "@/lib/studio/plan-order";

import { ChapterBlock } from "./chapter-block";
import { focusSceneCard } from "./scene-card";
import { StoryLine } from "./story-line";
import {
  OutlineOpenProvider,
  useOutlineFocusTracker,
  useOutlineOpen,
} from "./use-outline-open";
import {
  computeOutlineData,
  OUTLINE_LINE_ATTRIBUTE,
  type OutlineDrop,
  type OutlineView,
  OutlineViewContext,
  STORY_LINE_KEY,
} from "./use-outline-view";

// A private type, so a dragged line can never be dropped as text into a field.
const DRAG_TYPE = "application/x-localink-plan-item";

/** The line element an event came from, or null. */
function lineOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const line = target.closest(`[${OUTLINE_LINE_ATTRIBUTE}]`);
  return line instanceof HTMLElement ? line : null;
}

function focusLine(id: string) {
  document.getElementById(studioOutlineLineId(id))?.focus();
}

/** The siblings an item moves among: chapters, or its parent's children. */
function siblingsOf(
  tree: StudioPlanNode[],
  item: StudioPlanItemDto,
): StudioPlanNode[] {
  if (item.parentId === null) return tree;
  const find = (nodes: StudioPlanNode[]): StudioPlanNode[] | null => {
    for (const node of nodes) {
      if (node.id === item.parentId) return node.children;
      const found = find(node.children);
      if (found) return found;
    }
    return null;
  };
  return find(tree) ?? [];
}

/**
 * The compact outline: the premise line, then every chapter and scene as one
 * line that opens in place. One scene card is open at a time.
 */
export function Outline() {
  return (
    <OutlineOpenProvider>
      <OutlineBody />
    </OutlineOpenProvider>
  );
}

function OutlineBody() {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const storyPlan = useStoryFleshOut();
  const actions = usePlanTreeActions();
  const planStatuses = usePlanStatuses();
  const { close, collapse, openChapter, openChapterId, openSceneId } =
    useOutlineOpen();
  const trackFocus = useOutlineFocusTracker();
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<StudioPlanItemDto | null>(null);
  const [drop, setDrop] = useState<OutlineDrop | null>(null);

  const { flags, planItems, prose, readingItemId } = state;
  const tree = useMemo(() => buildPlanTree(planItems), [planItems]);
  const chapters = useMemo(
    () => tree.filter((node) => node.kind === "chapter"),
    [tree],
  );
  const emptyChapters = chapters.filter(
    (chapter) => chapter.children.length === 0,
  ).length;

  const draftMomentId = loop.draft?.momentId ?? null;
  const preparingSceneId = loop.preparingSceneId;
  const data = useMemo(
    () =>
      computeOutlineData({
        draftingIds: [draftMomentId, preparingSceneId],
        flags,
        items: planItems,
        prose,
        readingItemId,
        statuses: planStatuses,
      }),
    [
      draftMomentId,
      flags,
      planItems,
      planStatuses,
      preparingSceneId,
      prose,
      readingItemId,
    ],
  );
  const chapterNumbers = useMemo(
    () => new Map(chapters.map((chapter, index) => [chapter.id, index + 1])),
    [chapters],
  );

  // Exactly one line is tabbable: the last focused one if it is still shown,
  // else the open scene, the open chapter, or the premise.
  const visibleLineIds = new Set<string>([STORY_LINE_KEY]);
  for (const chapter of chapters) {
    visibleLineIds.add(chapter.id);
    if (chapter.id !== openChapterId) continue;
    for (const scene of chapter.children) visibleLineIds.add(scene.id);
  }
  const tabStopId =
    [activeLineId, openSceneId, openChapterId].find(
      (id): id is string => id !== null && visibleLineIds.has(id),
    ) ?? STORY_LINE_KEY;

  const draggingId = dragged?.id ?? null;
  const view = useMemo<OutlineView>(
    () => ({
      ...data,
      chapterNumbers,
      tabStopId,
      renamingId,
      setRenamingId,
      drop,
      draggingId,
    }),
    [chapterNumbers, data, draggingId, drop, renamingId, tabStopId],
  );

  const byId = useMemo(
    () => new Map(planItems.map((item) => [item.id, item])),
    [planItems],
  );

  function lineElements(): HTMLElement[] {
    const root = rootRef.current;
    if (!root) return [];
    return [
      ...root.querySelectorAll<HTMLElement>(`[${OUTLINE_LINE_ATTRIBUTE}]`),
    ];
  }

  async function moveAmongSiblings(item: StudioPlanItemDto, delta: -1 | 1) {
    const siblings = siblingsOf(tree, item);
    const index = siblings.findIndex((sibling) => sibling.id === item.id);
    const neighbor = siblings[index + delta];
    if (!neighbor) return;
    const target = resolvePlanDrop(planItems, item, neighbor, delta < 0);
    if (!target) return;
    await actions.move(item, target);
    requestAnimationFrame(() => focusLine(item.id));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    // Only keys pressed on a line itself; fields and buttons keep theirs.
    const line = event.target;
    if (!(line instanceof HTMLElement)) return;
    const lineId = line.getAttribute(OUTLINE_LINE_ATTRIBUTE);
    if (!lineId) return;
    const item = byId.get(lineId) ?? null;

    if (
      event.altKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      if (item) void moveAmongSiblings(item, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const lines = lineElements();
    const index = lines.indexOf(line);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const next = lines[index + (event.key === "ArrowDown" ? 1 : -1)];
        next?.focus();
        return;
      }
      case "Home":
      case "End": {
        event.preventDefault();
        (event.key === "Home" ? lines[0] : lines.at(-1))?.focus();
        return;
      }
      case "ArrowRight": {
        if (item?.kind === "chapter" && openChapterId !== item.id) {
          event.preventDefault();
          openChapter(item.id);
        }
        return;
      }
      case "ArrowLeft": {
        if (item?.kind === "chapter" && openChapterId === item.id) {
          event.preventDefault();
          collapse();
        } else if (item?.kind === "scene" && item.parentId) {
          event.preventDefault();
          focusLine(item.parentId);
        }
        return;
      }
      case "F2": {
        if (!item) return;
        event.preventDefault();
        if (item.id === openSceneId) focusSceneCard(item.id, "title");
        else setRenamingId(item.id);
        return;
      }
      case "Escape": {
        if (!item) return;
        if (item.kind === "scene" && openSceneId) {
          // Another scene's card is open: close it, stay on this line.
          event.preventDefault();
          close();
        } else if (item.kind === "scene" && openChapterId) {
          // Nothing else open: close the chapter and go back to its line.
          event.preventDefault();
          const chapterId = openChapterId;
          collapse();
          requestAnimationFrame(() => focusLine(chapterId));
        } else if (item.kind === "chapter" && openChapterId === item.id) {
          event.preventDefault();
          collapse();
        }
        return;
      }
    }
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    trackFocus(event.target instanceof Element ? event.target : null);
    const lineId =
      event.target instanceof HTMLElement
        ? event.target.getAttribute(OUTLINE_LINE_ATTRIBUTE)
        : null;
    if (lineId) setActiveLineId(lineId);
  }

  /** Where a drag over `event`'s line would land, or null. */
  function dropFor(event: DragEvent<HTMLDivElement>): OutlineDrop | null {
    const line = lineOf(event.target);
    const target = line
      ? byId.get(line.getAttribute(OUTLINE_LINE_ATTRIBUTE) ?? "")
      : undefined;
    if (!dragged || !line || !target) return null;
    const bounds = line.getBoundingClientRect();
    const upperHalf = event.clientY < bounds.top + bounds.height / 2;
    const resolved = resolvePlanDrop(planItems, dragged, target, upperHalf);
    return resolved ? { ...resolved, targetId: target.id } : null;
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    const line = event.target;
    if (!(line instanceof HTMLElement) || !line.draggable) return;
    const item = byId.get(line.getAttribute(OUTLINE_LINE_ATTRIBUTE) ?? "");
    if (!item) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_TYPE, item.id);
    setDragged(item);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!dragged) return;
    const next = dropFor(event);
    if (next) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
    setDrop((current) =>
      current?.targetId === next?.targetId &&
      current?.hint === next?.hint &&
      current?.index === next?.index
        ? current
        : next,
    );
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!dragged) return;
    event.preventDefault();
    const target = dropFor(event);
    const item = dragged;
    setDragged(null);
    setDrop(null);
    if (target) void actions.move(item, target);
  }

  function handleDragEnd() {
    setDragged(null);
    setDrop(null);
  }

  async function addChapter() {
    const created = await actions.addChapter();
    if (!created) return;
    openChapter(created.id);
    setRenamingId(created.id);
  }

  return (
    <OutlineViewContext.Provider value={view}>
      <div
        aria-label="Outline"
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 pb-4 font-normal text-label-sm"
        // Focus inside this element pauses reading-position following.
        data-studio-outline=""
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onFocus={handleFocus}
        onBlur={() => trackFocus(null)}
        onKeyDown={handleKeyDown}
        ref={rootRef}
        role="tree"
      >
        <StoryLine />
        {storyPlan.phase !== "idle" ? (
          <div className="flex h-7 items-center gap-2 px-2 font-normal text-muted-foreground">
            <span aria-hidden="true" className="text-studio-proposed">
              ✦
            </span>
            {storyPlan.phase === "planning"
              ? "Planning scenes for every chapter…"
              : "Saving the planned scenes…"}
            {storyPlan.phase === "planning" ? (
              <Button
                className="h-6 px-2 text-caption"
                onClick={storyPlan.cancel}
                size="sm"
                type="button"
                variant="ghost"
              >
                Stop
              </Button>
            ) : null}
          </div>
        ) : storyPlan.canPlan ? (
          <button
            className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left font-normal text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={storyPlan.start}
            type="button"
          >
            <span aria-hidden="true" className="text-studio-proposed">
              ✦
            </span>
            Plan scenes for {emptyChapters}{" "}
            {emptyChapters === 1 ? "chapter" : "chapters"}
          </button>
        ) : null}
        {chapters.map((chapter) => (
          <ChapterBlock chapter={chapter} key={chapter.id} />
        ))}
        {chapters.length === 0 ? (
          <p className="px-2 py-3 font-normal text-caption text-muted-foreground">
            No chapters yet. Add one to start planning.
          </p>
        ) : null}
        <button
          className="flex h-7 items-center gap-1.5 rounded-md px-2 text-left font-normal text-muted-foreground/70 outline-none hover:bg-foreground/5 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => void addChapter()}
          type="button"
        >
          <Plus aria-hidden="true" className="size-3" />
          Chapter
        </button>
      </div>
    </OutlineViewContext.Provider>
  );
}
