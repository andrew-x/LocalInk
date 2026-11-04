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
  expandStudioBundleAccept,
  resolveStudioBundleRef,
  type StudioBundleDecision,
  type StudioBundleDto,
  type StudioBundleIssueKind,
  type StudioBundleOpDto,
  type StudioBundleResolution,
  type StudioBundleSelectionIssue,
} from "@/lib/studio/bundle-contract";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

const FLUSH_FAILED =
  "A moment has edits that could not be saved yet, so the changes were not applied. Try again once it saves.";
const RELOAD_FAILED =
  "This was already resolved, but the story could not be reloaded. Refresh the page.";
const READ_BACK_FAILED =
  "The changes were applied, but a rewritten moment could not be re-read. Try Re-read in the scene's ⋯ menu.";
const TRACKING_FAILED =
  "Some tracking updates couldn't be applied — see the conversation.";

/** The plan item a tracking op is pinned to (saved or temp id), or null. */
function trackingTarget(op: StudioBundleOpDto): string | null {
  if (op.kind === "change.create") return op.planItemRef;
  if (op.kind === "change.update" || op.kind === "change.delete") {
    return op.baseline.planItemId;
  }
  return null;
}

/**
 * The plan item a visible op is about: a plan create (its temp id) or
 * update, or a prose write's moment. Moves and deletes tie no tracking: a
 * move does not change what happens there, and accepting a delete already
 * dismisses what was pinned inside it.
 */
function anchorTarget(op: StudioBundleOpDto): string | null {
  if (op.kind === "plan.create") return op.tempId;
  if (op.kind === "plan.update") return op.itemId;
  if (op.kind === "prose.write") return op.momentRef;
  return null;
}

/**
 * Pending tracking ops (change records) tied to the given ops: pinned to the
 * item one of them creates, edits, or writes prose for. Refs compare after
 * resolving temp ids through accepted creates. They ride along with that
 * op's ✓ and ✕; tracking ops tied to nothing stay in the conversation list.
 */
export function tiedTrackingOps(
  operations: StudioBundleOpDto[],
  opIds: Iterable<string>,
): StudioBundleOpDto[] {
  const anchors = new Set(opIds);
  const resolve = (ref: string) =>
    resolveStudioBundleRef(operations, ref) ?? ref;
  const targets = new Set<string>();
  for (const op of operations) {
    const target = anchors.has(op.id) ? anchorTarget(op) : null;
    if (target === null) continue;
    targets.add(target);
    targets.add(resolve(target));
  }
  if (targets.size === 0) return [];
  return operations.filter((op) => {
    if (op.status !== "pending") return false;
    const target = trackingTarget(op);
    return (
      target !== null && (targets.has(target) || targets.has(resolve(target)))
    );
  });
}

type DecisionOutcome =
  | { resolution: StudioBundleResolution }
  | { failure: string; serverError: boolean };

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

/** A decision is running right now (for callers outside React render). */
export function isBundleDecisionRunning(): boolean {
  return shared.busy;
}

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
 * clear their undo history), accepts the tracking tied to what was accepted
 * (`acceptTiedTracking`), then force-reads-back accepted prose, so read-back
 * already sees those records.
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

  const requestDecision = useCallback(
    async (
      bundleId: string,
      decision: StudioBundleDecision,
      opIds: string[] | null,
    ): Promise<DecisionOutcome> => {
      try {
        const result = await resolveStudioBundle({
          storyId,
          bundleId,
          decision,
          opIds,
        });
        if (result?.data) return { resolution: result.data };
        return {
          failure: actionFailureMessage(result, STUDIO_ACTION_FALLBACK_MESSAGE),
          serverError: Boolean(result?.serverError),
        };
      } catch {
        return { failure: STUDIO_ACTION_FALLBACK_MESSAGE, serverError: false };
      }
    },
    [storyId],
  );

  const mergeResolution = useCallback(
    (resolution: StudioBundleResolution) => {
      const { removed, ...patch } = resolution.workspacePatch;
      dispatch({
        type: "merge",
        ...patch,
        bundles: [resolution.bundle],
        removed,
      });
    },
    [dispatch],
  );

  /**
   * The second phase of an accept: the pending tracking ops tied to what the
   * first phase accepted. A separate request, so a conflicting tracking op
   * can never block the suggestion the author approved. Ops that would pull
   * in another unreviewed create (a new entry, say) stay in the list.
   */
  const acceptTiedTracking = useCallback(
    async (
      bundleId: string,
      previous: StudioBundleDto,
      latest: StudioBundleDto,
      requested: string[],
    ): Promise<StudioBundleDto> => {
      const before = new Map(
        previous.operations.map((op) => [op.id, op.status]),
      );
      const asked = new Set(requested);
      const accepted = latest.operations
        .filter(
          (op) =>
            op.status === "accepted" &&
            (asked.has(op.id) || before.get(op.id) !== "accepted"),
        )
        .map((op) => op.id);
      const tied = tiedTrackingOps(latest.operations, accepted)
        .filter(
          (op) =>
            expandStudioBundleAccept(latest.operations, [op.id]).size === 1,
        )
        .map((op) => op.id);
      if (tied.length === 0) return latest;
      const outcome = await requestDecision(bundleId, "accept", tied);
      if (!("resolution" in outcome)) {
        toast.error(TRACKING_FAILED);
        if (outcome.serverError) await markIssues(bundleId, tied);
        return latest;
      }
      if (outcome.resolution.replayed) return latest;
      mergeResolution(outcome.resolution);
      return outcome.resolution.bundle;
    },
    [markIssues, mergeResolution, requestDecision],
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
        // Dismissing a suggestion also dismisses the tracking tied to it, in
        // the same request: dismissals cannot conflict.
        const requested =
          decision === "reject" && selection
            ? [
                ...new Set([
                  ...selection,
                  ...tiedTrackingOps(bundle.operations, selection).map(
                    (op) => op.id,
                  ),
                ]),
              ]
            : selection;
        const outcome = await requestDecision(bundleId, decision, requested);
        if (!("resolution" in outcome)) {
          toast.error(outcome.failure);
          if (decision === "accept" && outcome.serverError) {
            await markIssues(bundleId, selection);
          }
          return false;
        }
        const { resolution } = outcome;
        if (resolution.replayed) {
          // The first response may have been lost before its read-back ran.
          await reloadWorkspace();
        } else {
          mergeResolution(resolution);
        }

        if (decision === "accept") {
          const latest = selection
            ? await acceptTiedTracking(
                bundleId,
                bundle,
                resolution.bundle,
                selection,
              )
            : resolution.bundle;
          await readBackAccepted(latest, bundle);
        }
        return true;
      } finally {
        updateShared({ busy: false });
      }
    },
    [
      acceptTiedTracking,
      markIssues,
      mergeResolution,
      readBackAccepted,
      reloadWorkspace,
      requestDecision,
    ],
  );

  return { resolve, busy, issuesFor, issueCount };
}
