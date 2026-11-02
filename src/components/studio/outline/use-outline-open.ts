"use client";

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { computePlanStatuses } from "@/components/studio/workspace/plan-status";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { scrollToStudioItem } from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { buildPlanTree } from "@/lib/studio/plan-order";

/**
 * Marks the outline's root element (written out in outline.tsx), so focus
 * inside it can be detected.
 */
const OUTLINE_ROOT_ATTRIBUTE = "data-studio-outline";

type OpenState = { chapterId: string | null; sceneId: string | null };

export type OutlineOpen = {
  openChapterId: string | null;
  openSceneId: string | null;
  /** Opens a chapter; an open scene stays open only if it is inside it. */
  openChapter: (id: string) => void;
  /** Opens a scene card (one at a time) and its chapter. */
  openScene: (id: string) => void;
  /** Closes the open scene card, or the open chapter when no card is open. */
  close: () => void;
  /** Closes the chapter and any card in it. */
  collapse: () => void;
};

type OutlineOpenContextValue = OutlineOpen & {
  reportEdits: (key: string, dirty: boolean) => void;
  trackFocus: (target: Element | null) => void;
};

const OutlineOpenContext = createContext<OutlineOpenContextValue | null>(null);

/** The chapter and scene an item sits in (a moment opens its scene). */
function locate(items: StudioPlanItemDto[], itemId: string): OpenState | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const item = byId.get(itemId);
  if (!item) return null;
  if (item.kind === "chapter") return { chapterId: item.id, sceneId: null };
  const scene =
    item.kind === "scene"
      ? item
      : item.parentId
        ? byId.get(item.parentId)
        : undefined;
  if (!scene) return null;
  return { chapterId: scene.parentId, sceneId: scene.id };
}

/**
 * On load: where the reader is, else the first chapter that is not fully
 * written. Written chapters start collapsed.
 */
function initialOpen(
  items: StudioPlanItemDto[],
  readingItemId: string | null,
  statuses: Map<string, string>,
): OpenState {
  const reading = readingItemId ? locate(items, readingItemId) : null;
  if (reading) return reading;
  const current = buildPlanTree(items).find(
    (node) => node.kind === "chapter" && statuses.get(node.id) !== "written",
  );
  return { chapterId: current?.id ?? null, sceneId: null };
}

/**
 * Focus is in the outline, or in a menu or dialog the outline opened, judged
 * from the live DOM. Those menus are portaled outside the outline's DOM, so
 * `outlineFocus` is the last element a React focus event (which bubbles
 * through portals) reported from the outline's tree. It only counts while it
 * still holds focus: a removed element fires no blur, but focus has moved on.
 */
function focusIsInOutline(outlineFocus: Element | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (active.closest(`[${OUTLINE_ROOT_ATTRIBUTE}]`)) return true;
  return Boolean(outlineFocus?.isConnected && outlineFocus.contains(active));
}

/**
 * Which chapter and scene card the outline has open, provided above the plan
 * pane so the AI box can read it too. It follows the reading
 * position and selections made elsewhere (manuscript, Characters), but only
 * while the author is not working in the outline: focus is outside it (and
 * its menus and dialogs) and no outline editor holds unsaved text. Following
 * never moves focus, so scrolling the manuscript cannot collapse a card being
 * edited or drop what was typed in it.
 */
export function OutlineOpenProvider({ children }: { children: ReactNode }) {
  const { state } = useStudioStore();
  const { planItems, readingItemId, selectNonce, selectedItemId } = state;
  const [open, setOpen] = useState<OpenState>(() =>
    initialOpen(
      planItems,
      readingItemId,
      computePlanStatuses(planItems, state.prose, state.flags),
    ),
  );
  const itemsRef = useRef(planItems);
  useEffect(() => {
    itemsRef.current = planItems;
  }, [planItems]);
  const dirtyEditors = useRef(new Set<string>());
  const outlineFocus = useRef<Element | null>(null);

  const reportEdits = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyEditors.current.add(key);
    else dirtyEditors.current.delete(key);
  }, []);

  // Blur fires before the next focus, so moving within the outline ends set.
  const trackFocus = useCallback((target: Element | null) => {
    outlineFocus.current = target;
  }, []);

  const follow = useCallback((itemId: string) => {
    if (
      focusIsInOutline(outlineFocus.current) ||
      dirtyEditors.current.size > 0
    ) {
      return;
    }
    const target = locate(itemsRef.current, itemId);
    if (!target) return;
    setOpen((current) =>
      current.chapterId === target.chapterId &&
      current.sceneId === target.sceneId
        ? current
        : target,
    );
    const lineId = target.sceneId ?? target.chapterId;
    // Scrolls the outline only; focus stays where it is.
    if (lineId) requestAnimationFrame(() => scrollToStudioItem(lineId));
  }, []);

  useEffect(() => {
    if (readingItemId) follow(readingItemId);
  }, [follow, readingItemId]);

  // The nonce moves on every select, including repeats of the same item.
  useEffect(() => {
    if (selectNonce > 0 && selectedItemId) follow(selectedItemId);
  }, [follow, selectNonce, selectedItemId]);

  // Resolved against the current items on every render: ids that no longer
  // exist (deleted) read as closed, and an open scene always opens its own
  // chapter, even one created a moment ago.
  const byId = useMemo(
    () => new Map(planItems.map((item) => [item.id, item])),
    [planItems],
  );
  const scene = open.sceneId ? byId.get(open.sceneId) : undefined;
  const openSceneId = scene?.kind === "scene" ? scene.id : null;
  const openChapterId =
    scene?.kind === "scene"
      ? scene.parentId
      : open.chapterId && byId.has(open.chapterId)
        ? open.chapterId
        : null;

  const openChapter = useCallback((id: string) => {
    setOpen((current) => {
      const scene = current.sceneId
        ? locate(itemsRef.current, current.sceneId)
        : null;
      return {
        chapterId: id,
        sceneId: scene?.chapterId === id ? current.sceneId : null,
      };
    });
  }, []);

  // The scene may be brand new and not in `itemsRef` yet; render resolves it.
  const openScene = useCallback((id: string) => {
    setOpen((current) => ({
      chapterId: locate(itemsRef.current, id)?.chapterId ?? current.chapterId,
      sceneId: id,
    }));
  }, []);

  const close = useCallback(() => {
    setOpen((current) => {
      if (!current.sceneId) return { chapterId: null, sceneId: null };
      const chapterId =
        locate(itemsRef.current, current.sceneId)?.chapterId ??
        current.chapterId;
      return { chapterId, sceneId: null };
    });
  }, []);

  const collapse = useCallback(
    () => setOpen({ chapterId: null, sceneId: null }),
    [],
  );

  const value = useMemo<OutlineOpenContextValue>(
    () => ({
      openChapterId,
      openSceneId,
      openChapter,
      openScene,
      close,
      collapse,
      reportEdits,
      trackFocus,
    }),
    [
      close,
      collapse,
      openChapter,
      openChapterId,
      openScene,
      openSceneId,
      reportEdits,
      trackFocus,
    ],
  );
  return createElement(OutlineOpenContext.Provider, { value }, children);
}

function useOutlineOpenContext(): OutlineOpenContextValue {
  const value = useContext(OutlineOpenContext);
  if (!value) {
    throw new Error("useOutlineOpen must be used inside OutlineOpenProvider.");
  }
  return value;
}

export function useOutlineOpen(): OutlineOpen {
  const {
    openChapterId,
    openSceneId,
    openChapter,
    openScene,
    close,
    collapse,
  } = useOutlineOpenContext();
  return {
    openChapterId,
    openSceneId,
    openChapter,
    openScene,
    close,
    collapse,
  };
}

/**
 * The item the outline has open: its scene card, else its expanded chapter,
 * else null. The AI box sends it as "Looking at".
 */
export function useOutlineOpenItemId(): string | null {
  const { openChapterId, openSceneId } = useOutlineOpenContext();
  return openSceneId ?? openChapterId;
}

/**
 * For autosaved editors in the outline: pass the result as
 * `useAutosaveFields({ onDirtyChange })`. While any editor holds unsaved
 * text, the outline does not follow the reading position.
 */
export function useOutlineEditReporter(): (dirty: boolean) => void {
  const { reportEdits } = useOutlineOpenContext();
  const key = useId();
  // An unmounted editor has flushed (or given up); it no longer holds edits.
  useEffect(() => () => reportEdits(key, false), [key, reportEdits]);
  return useCallback(
    (dirty: boolean) => reportEdits(key, dirty),
    [key, reportEdits],
  );
}

/**
 * The outline root reports the element its React focus events came from
 * (including portaled menus), and null on blur.
 */
export function useOutlineFocusTracker(): (target: Element | null) => void {
  return useOutlineOpenContext().trackFocus;
}
