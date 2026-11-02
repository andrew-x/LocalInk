"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { checkStudioBundleSelection } from "@/actions/studio/check-studio-bundle-selection";
import { getStudioWorkspace } from "@/actions/studio/get-studio-workspace";
import { resolveStudioBundle } from "@/actions/studio/resolve-studio-bundle";
import { flushMomentEditors } from "@/components/studio/manuscript/editor-registry";
import {
  actionFailureMessage,
  readBackStudioMoment,
} from "@/components/studio/manuscript/read-back-client";
import { studioErrorMessage } from "@/components/studio/studio-fetch";
import {
  STUDIO_ACTION_FALLBACK_MESSAGE,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import {
  resolveStudioBundleRef,
  type StudioBundleDecision,
  type StudioBundleDto,
  type StudioBundleIssueKind,
  type StudioBundleSelectionIssue,
} from "@/lib/studio/bundle-contract";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

const FLUSH_FAILED =
  "A moment has edits that could not be saved yet, so the changes were not applied. Try again once it saves.";
const RELOAD_FAILED =
  "This was already resolved, but the story could not be reloaded. Refresh the page.";
const READ_BACK_FAILED =
  "The changes were applied, but a rewritten moment could not be re-read. Try Re-read in the scene's ⋯ menu.";

/** Saved moments at or under `rootId`. */
function subtreeMomentIds(
  planItems: StudioPlanItemDto[],
  rootId: string,
): string[] {
  const inside = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of planItems) {
      if (item.parentId && inside.has(item.parentId) && !inside.has(item.id)) {
        inside.add(item.id);
        grew = true;
      }
    }
  }
  return planItems
    .filter((item) => item.kind === "moment" && inside.has(item.id))
    .map((item) => item.id);
}

/**
 * Saved moments whose prose a decision would write, revert, or remove: prose
 * ops, the subtree of an accepted plan.delete, and the items an undo would
 * delete again (a plan.create's subtree). Their mounted editors are flushed
 * first so unsaved typing is caught by the baseline checks, not lost.
 */
function affectedMomentIds(
  bundle: StudioBundleDto,
  decision: StudioBundleDecision,
  opIds: string[] | null,
  planItems: StudioPlanItemDto[],
): string[] {
  if (decision === "reject") return [];
  const selected = opIds ? new Set(opIds) : null;
  const ids = new Set<string>();
  for (const op of bundle.operations) {
    const applies =
      decision === "accept"
        ? op.status === "pending" && (!selected || selected.has(op.id))
        : op.status === "accepted";
    if (!applies) continue;
    if (op.kind === "prose.write") {
      // A temp ref resolves only once its create was accepted (undo).
      const momentId = resolveStudioBundleRef(bundle.operations, op.momentRef);
      if (momentId) ids.add(momentId);
    } else if (op.kind === "plan.delete" && decision === "accept") {
      for (const id of subtreeMomentIds(planItems, op.itemId)) ids.add(id);
    } else if (op.kind === "plan.create" && decision === "undo") {
      const createdId = resolveStudioBundleRef(bundle.operations, op.tempId);
      if (!createdId) continue;
      for (const id of subtreeMomentIds(planItems, createdId)) ids.add(id);
    }
  }
  return [...ids];
}

const ISSUE_TEXT: Record<StudioBundleIssueKind, string> = {
  conflict:
    "The story changed since this was suggested, so it can't be applied. Dismiss it, or ask the AI again.",
  "missing-dependency":
    "Needs another suggestion that can't be applied with it.",
  "dependency-dismissed":
    "Needs a suggestion that was dismissed or undone, so it can't be applied.",
  dismissed: "Already dismissed or undone.",
  "too-many-fields":
    "Would leave this entry with more details than are allowed.",
  invalid: "Can't be applied as suggested.",
};

/** Sanitized, user-facing text for why an op could not be accepted. */
export function bundleIssueText(issue: StudioBundleSelectionIssue): string {
  return ISSUE_TEXT[issue.kind];
}

type ResolveShared = {
  /** A decision is running; there is one at a time across the workspace. */
  busy: boolean;
  /** The ops the last refused accept named, by op id, for one bundle. */
  issues: {
    bundleId: string;
    byOpId: ReadonlyMap<string, StudioBundleSelectionIssue[]>;
  } | null;
};

// Shared by every caller (outline lines, entry cards, the manuscript draft,
// the AI box bar and the conversation list), so a refused accept marks the
// op wherever it shows and every ✓/✕ waits for the decision in flight.
let shared: ResolveShared = { busy: false, issues: null };
const listeners = new Set<() => void>();

function updateShared(patch: Partial<ResolveShared>) {
  shared = { ...shared, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getShared = () => shared;

const NO_ISSUES: StudioBundleSelectionIssue[] = [];

export type ResolveBundle = {
  /**
   * Resolves to whether the decision took effect. `opIds: null` means every
   * pending op (accept, reject); undo ignores it.
   */
  resolve(
    bundleId: string,
    decision: StudioBundleDecision,
    opIds?: string[] | null,
  ): Promise<boolean>;
  busy: boolean;
  /** Why the last refused accept could not apply this op, if it named it. */
  issuesFor(bundleId: string, opId: string): StudioBundleSelectionIssue[];
  /** How many ops the last refused accept of this bundle named. */
  issueCount(bundleId: string): number;
};

/**
 * Accepts, rejects, or undoes a bundle. Flushes affected moment editors first
 * (so unsaved typing is caught by the baseline check rather than overwritten),
 * merges the returned patch (mounted editors load newer prose themselves and
 * clear their undo history), then force-reads-back accepted prose.
 */
export function useResolveBundle(): ResolveBundle {
  const { state, dispatch } = useStudioStore();
  const { busy, issues } = useSyncExternalStore(
    subscribe,
    getShared,
    getShared,
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const storyId = state.story.id;

  const issuesFor = useCallback(
    (bundleId: string, opId: string) =>
      issues?.bundleId === bundleId
        ? (issues.byOpId.get(opId) ?? NO_ISSUES)
        : NO_ISSUES,
    [issues],
  );
  const issueCount = useCallback(
    (bundleId: string) =>
      issues?.bundleId === bundleId ? issues.byOpId.size : 0,
    [issues],
  );

  const markIssues = useCallback(
    async (bundleId: string, opIds: string[] | null) => {
      try {
        const check = await checkStudioBundleSelection({
          storyId,
          bundleId,
          opIds,
        });
        const next = new Map<string, StudioBundleSelectionIssue[]>();
        for (const issue of check.issues) {
          next.set(issue.opId, [...(next.get(issue.opId) ?? []), issue]);
        }
        updateShared({ issues: { bundleId, byOpId: next } });
      } catch {
        // The sanitized toast for the failed accept is already showing.
      }
    },
    [storyId],
  );

  const reloadWorkspace = useCallback(async () => {
    try {
      const workspace = await getStudioWorkspace(storyId);
      if (workspace) dispatch({ type: "replace", workspace });
      else toast.error(RELOAD_FAILED);
    } catch {
      toast.error(RELOAD_FAILED);
    }
  }, [dispatch, storyId]);

  /**
   * Forced read-back of each prose op accepted since `previous` (the
   * store's copy before this decision), one at a time. Prose accepted by an
   * earlier decision was read back then.
   */
  const readBackAccepted = useCallback(
    async (bundle: StudioBundleDto, previous: StudioBundleDto) => {
      const before = new Map(
        previous.operations.map((op) => [op.id, op.status]),
      );
      const momentIds = new Set<string>();
      for (const op of bundle.operations) {
        if (op.kind !== "prose.write" || op.status !== "accepted") continue;
        if (before.get(op.id) === "accepted") continue;
        const momentId = resolveStudioBundleRef(
          bundle.operations,
          op.momentRef,
        );
        if (momentId) momentIds.add(momentId);
      }
      for (const momentId of momentIds) {
        try {
          const patch = await readBackStudioMoment({
            storyId,
            momentId,
            force: true,
          });
          if (patch) dispatch({ type: "merge", ...patch });
        } catch (error) {
          toast.error(studioErrorMessage(error, READ_BACK_FAILED));
        }
      }
    },
    [dispatch, storyId],
  );

  const resolve = useCallback(
    async (
      bundleId: string,
      decision: StudioBundleDecision,
      opIds: string[] | null = null,
    ): Promise<boolean> => {
      if (shared.busy) return false;
      const bundle = stateRef.current.bundles.find((b) => b.id === bundleId);
      if (!bundle) {
        toast.error("These changes are no longer available.");
        return false;
      }
      updateShared({ busy: true, issues: null });
      try {
        const momentIds = affectedMomentIds(
          bundle,
          decision,
          opIds,
          stateRef.current.planItems,
        );
        if (momentIds.length > 0 && !(await flushMomentEditors(momentIds))) {
          toast.error(FLUSH_FAILED);
          return false;
        }

        const selection = decision === "undo" ? null : opIds;
        let result: Awaited<ReturnType<typeof resolveStudioBundle>>;
        try {
          result = await resolveStudioBundle({
            storyId,
            bundleId,
            decision,
            opIds: selection,
          });
        } catch {
          toast.error(STUDIO_ACTION_FALLBACK_MESSAGE);
          return false;
        }
        const resolution = result?.data;
        if (!resolution) {
          toast.error(
            actionFailureMessage(result, STUDIO_ACTION_FALLBACK_MESSAGE),
          );
          if (decision === "accept" && result?.serverError) {
            await markIssues(bundleId, selection);
          }
          return false;
        }

        if (resolution.replayed) {
          // The first response may have been lost before its read-back ran.
          await reloadWorkspace();
          if (decision === "accept") {
            await readBackAccepted(resolution.bundle, bundle);
          }
          return true;
        }
        const { removed, ...patch } = resolution.workspacePatch;
        dispatch({
          type: "merge",
          ...patch,
          bundles: [resolution.bundle],
          removed,
        });

        if (decision === "accept") {
          await readBackAccepted(resolution.bundle, bundle);
        }
        return true;
      } finally {
        updateShared({ busy: false });
      }
    },
    [dispatch, markIssues, readBackAccepted, reloadWorkspace, storyId],
  );

  return { resolve, busy, issuesFor, issueCount };
}
