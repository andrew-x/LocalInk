"use client";

import {
  createContext,
  createElement,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import { toast } from "sonner";

import type { StudioBundleDto } from "@/lib/studio/bundle-contract";
import type {
  StudioChangeDto,
  StudioEntryDto,
  StudioFlagDto,
  StudioPlanItemDto,
  StudioProseDto,
  StudioStoryDto,
  StudioWorkspace,
} from "@/lib/studio/contracts";

import { computePlanStatuses } from "./plan-status";

export type StudioPlanTab = "outline" | "characters";

/**
 * A review-card op. Op ids are unique only within their bundle (every turn
 * numbers from op-1), so focus always names the bundle too.
 */
export type StudioBundleOpFocus = { bundleId: string; opId: string };

export type StudioStoreState = StudioWorkspace & {
  /** Read-only global instructions, shown in Story settings. */
  globalInstructions: string;
  selectedItemId: string | null;
  /**
   * Bumped by every "select", so selecting the item that is already selected
   * still asks the manuscript to scroll to it.
   */
  selectNonce: number;
  readMode: boolean;
  /**
   * The plan pane's tab. Chat state itself (threads, messages, the turn)
   * lives in the chat panel, not here: streamed tokens would otherwise
   * re-render the whole workspace.
   */
  planTab: StudioPlanTab;
  /** The moment the manuscript is showing (reading sync), or null. */
  readingItemId: string | null;
  /** The entry the Characters tab has open, or null. */
  openEntryId: string | null;
  /** The bundle op the chat review card should scroll to and highlight. */
  focusedBundleOp: StudioBundleOpFocus | null;
  /** Bumped by every focusBundleOp, so refocusing the same op re-highlights. */
  bundleFocusNonce: number;
};

export type StudioRemovedIds = {
  planItemIds?: string[];
  entryIds?: string[];
  changeIds?: string[];
  flagIds?: string[];
};

export type StudioStoreAction =
  | {
      type: "merge";
      planItems?: StudioPlanItemDto[];
      entries?: StudioEntryDto[];
      changes?: StudioChangeDto[];
      prose?: StudioProseDto[];
      flags?: StudioFlagDto[];
      story?: StudioStoryDto;
      bundles?: StudioBundleDto[];
      /** Dropped after the upserts, like a "remove" (bundle patches). */
      removed?: StudioRemovedIds;
    }
  | ({ type: "remove" } & StudioRemovedIds)
  | { type: "replace"; workspace: StudioWorkspace }
  | { type: "select"; itemId: string | null }
  | { type: "setReadMode"; value: boolean }
  | { type: "setPlanTab"; tab: StudioPlanTab }
  | { type: "setReading"; itemId: string | null }
  | { type: "openEntry"; entryId: string | null }
  | ({ type: "focusBundleOp" } & StudioBundleOpFocus)
  | { type: "clearBundleFocus" };

function upsert<T>(list: T[], incoming: T[], key: (item: T) => string): T[] {
  if (incoming.length === 0) return list;
  const next = new Map(list.map((item) => [key(item), item]));
  for (const item of incoming) next.set(key(item), item);
  return [...next.values()];
}

/**
 * Drops incoming prose older than what the store holds. Revisions only grow,
 * and a slow response (a read-back patch, say) must not roll a moment back
 * past a newer autosave.
 */
function freshProse(
  current: StudioProseDto[],
  incoming: StudioProseDto[],
): StudioProseDto[] {
  if (incoming.length === 0) return incoming;
  const revisions = new Map(current.map((p) => [p.momentId, p.revision]));
  return incoming.filter((p) => p.revision >= (revisions.get(p.momentId) ?? 0));
}

/**
 * Drops incoming bundles older than the stored copy. A chat thread read that
 * started before an accept must not put the bundle back to pending.
 */
function freshBundles(
  current: StudioBundleDto[],
  incoming: StudioBundleDto[],
): StudioBundleDto[] {
  if (incoming.length === 0) return incoming;
  const updatedAt = new Map(current.map((b) => [b.id, b.updatedAt]));
  return incoming.filter((b) => b.updatedAt >= (updatedAt.get(b.id) ?? ""));
}

function removeIds(
  state: StudioStoreState,
  action: StudioRemovedIds,
): StudioStoreState {
  const planIds = new Set(action.planItemIds);
  const entryIds = new Set(action.entryIds);
  const changeIds = new Set(action.changeIds);
  const flagIds = new Set(action.flagIds);
  if (
    planIds.size === 0 &&
    entryIds.size === 0 &&
    changeIds.size === 0 &&
    flagIds.size === 0
  ) {
    return state;
  }
  return {
    ...state,
    planItems: state.planItems.filter((i) => !planIds.has(i.id)),
    entries: state.entries.filter((e) => !entryIds.has(e.id)),
    // Records pinned to a removed plan item go with it.
    changes: state.changes.filter(
      (c) => !changeIds.has(c.id) && !planIds.has(c.planItemId),
    ),
    prose: state.prose.filter((p) => !planIds.has(p.momentId)),
    flags: state.flags.filter(
      (f) => !flagIds.has(f.id) && !planIds.has(f.planItemId),
    ),
    selectedItemId:
      state.selectedItemId && planIds.has(state.selectedItemId)
        ? null
        : state.selectedItemId,
  };
}

function studioReducer(
  state: StudioStoreState,
  action: StudioStoreAction,
): StudioStoreState {
  switch (action.type) {
    case "merge": {
      const merged: StudioStoreState = {
        ...state,
        story: action.story ?? state.story,
        planItems: upsert(
          state.planItems,
          action.planItems ?? [],
          (item) => item.id,
        ),
        entries: upsert(state.entries, action.entries ?? [], (e) => e.id),
        changes: upsert(state.changes, action.changes ?? [], (c) => c.id),
        prose: upsert(
          state.prose,
          freshProse(state.prose, action.prose ?? []),
          (p) => p.momentId,
        ),
        flags: upsert(state.flags, action.flags ?? [], (f) => f.id),
        bundles: upsert(
          state.bundles,
          freshBundles(state.bundles, action.bundles ?? []),
          (b) => b.id,
        ),
      };
      return action.removed ? removeIds(merged, action.removed) : merged;
    }
    case "remove":
      return removeIds(state, action);
    case "replace":
      return {
        ...state,
        ...action.workspace,
        selectedItemId: action.workspace.planItems.some(
          (item) => item.id === state.selectedItemId,
        )
          ? state.selectedItemId
          : null,
      };
    case "select":
      return {
        ...state,
        selectedItemId: action.itemId,
        selectNonce: state.selectNonce + 1,
      };
    case "setReadMode":
      return { ...state, readMode: action.value };
    case "setPlanTab":
      return state.planTab === action.tab
        ? state
        : { ...state, planTab: action.tab };
    case "setReading":
      return state.readingItemId === action.itemId
        ? state
        : { ...state, readingItemId: action.itemId };
    case "openEntry":
      return { ...state, openEntryId: action.entryId, planTab: "characters" };
    case "focusBundleOp":
      return {
        ...state,
        // The review card lives in the plan pane, which Read mode hides.
        readMode: false,
        focusedBundleOp: { bundleId: action.bundleId, opId: action.opId },
        bundleFocusNonce: state.bundleFocusNonce + 1,
      };
    case "clearBundleFocus":
      return state.focusedBundleOp === null
        ? state
        : { ...state, focusedBundleOp: null };
  }
}

type StudioStoreValue = {
  state: StudioStoreState;
  dispatch: Dispatch<StudioStoreAction>;
};

const StudioStoreContext = createContext<StudioStoreValue | null>(null);

export function StudioStoreProvider({
  initial,
  children,
}: {
  initial: StudioWorkspace & { globalInstructions?: string };
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    studioReducer,
    initial,
    (workspace): StudioStoreState => ({
      ...workspace,
      globalInstructions: workspace.globalInstructions ?? "",
      selectedItemId: null,
      selectNonce: 0,
      readMode: false,
      planTab: "outline",
      readingItemId: null,
      openEntryId: null,
      focusedBundleOp: null,
      bundleFocusNonce: 0,
    }),
  );
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return createElement(StudioStoreContext.Provider, { value }, children);
}

export function useStudioStore(): StudioStoreValue {
  const value = useContext(StudioStoreContext);
  if (!value) {
    throw new Error("useStudioStore must be used inside StudioStoreProvider.");
  }
  return value;
}

/**
 * Shows this bundle's review-card op in the chat. Manuscript markers call it.
 */
export function useFocusBundleOp(): (target: StudioBundleOpFocus) => void {
  const { dispatch } = useStudioStore();
  return useCallback(
    ({ bundleId, opId }: StudioBundleOpFocus) =>
      dispatch({ type: "focusBundleOp", bundleId, opId }),
    [dispatch],
  );
}

export function useSelectedItem(): StudioPlanItemDto | null {
  const { state } = useStudioStore();
  return useMemo(
    () =>
      state.planItems.find((item) => item.id === state.selectedItemId) ?? null,
    [state.planItems, state.selectedItemId],
  );
}

export function useProseByMomentId(): Map<string, StudioProseDto> {
  const { state } = useStudioStore();
  return useMemo(
    () => new Map(state.prose.map((p) => [p.momentId, p])),
    [state.prose],
  );
}

export function usePlanStatuses() {
  const { state } = useStudioStore();
  return useMemo(
    () => computePlanStatuses(state.planItems, state.prose, state.flags),
    [state.planItems, state.prose, state.flags],
  );
}

type SafeResult<T> =
  | {
      data?: T;
      serverError?: { message?: string };
      validationErrors?: { formErrors?: string[] };
    }
  | undefined;

export const STUDIO_ACTION_FALLBACK_MESSAGE =
  "Something went wrong. Please try again.";

/**
 * Runs a safe action, toasts a sanitized message on failure, and returns the
 * data or null. Never pass or log writing here; only server messages surface.
 */
export function useRunStudioAction() {
  return useCallback(
    async <T>(
      run: Promise<SafeResult<T>>,
      fallback: string = STUDIO_ACTION_FALLBACK_MESSAGE,
    ): Promise<T | null> => {
      try {
        const result = await run;
        if (result?.data !== undefined) return result.data;
        toast.error(
          result?.serverError?.message ??
            result?.validationErrors?.formErrors?.[0] ??
            fallback,
        );
      } catch {
        toast.error(fallback);
      }
      return null;
    },
    [],
  );
}
