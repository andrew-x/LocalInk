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

export type StudioBibleTarget = { section: string; entryId?: string };

export type StudioStoreState = StudioWorkspace & {
  /** Read-only global instructions, kept for the Inspect panel. */
  globalInstructions: string;
  selectedItemId: string | null;
  readMode: boolean;
  bibleOpen: StudioBibleTarget | null;
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
    }
  | {
      type: "remove";
      planItemIds?: string[];
      entryIds?: string[];
      changeIds?: string[];
      flagIds?: string[];
    }
  | { type: "replace"; workspace: StudioWorkspace }
  | { type: "select"; itemId: string | null }
  | { type: "setReadMode"; value: boolean }
  | ({ type: "openBible" } & StudioBibleTarget)
  | { type: "closeBible" };

function upsert<T>(list: T[], incoming: T[], key: (item: T) => string): T[] {
  if (incoming.length === 0) return list;
  const next = new Map(list.map((item) => [key(item), item]));
  for (const item of incoming) next.set(key(item), item);
  return [...next.values()];
}

function studioReducer(
  state: StudioStoreState,
  action: StudioStoreAction,
): StudioStoreState {
  switch (action.type) {
    case "merge":
      return {
        ...state,
        story: action.story ?? state.story,
        planItems: upsert(
          state.planItems,
          action.planItems ?? [],
          (item) => item.id,
        ),
        entries: upsert(state.entries, action.entries ?? [], (e) => e.id),
        changes: upsert(state.changes, action.changes ?? [], (c) => c.id),
        prose: upsert(state.prose, action.prose ?? [], (p) => p.momentId),
        flags: upsert(state.flags, action.flags ?? [], (f) => f.id),
      };
    case "remove": {
      const planIds = new Set(action.planItemIds);
      const entryIds = new Set(action.entryIds);
      const changeIds = new Set(action.changeIds);
      const flagIds = new Set(action.flagIds);
      const planItems = state.planItems.filter((i) => !planIds.has(i.id));
      return {
        ...state,
        planItems,
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
      return { ...state, selectedItemId: action.itemId };
    case "setReadMode":
      return { ...state, readMode: action.value };
    case "openBible":
      return {
        ...state,
        bibleOpen: { section: action.section, entryId: action.entryId },
      };
    case "closeBible":
      return { ...state, bibleOpen: null };
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
      readMode: false,
      bibleOpen: null,
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
