import "server-only";

import { isDeepStrictEqual } from "node:util";

import { ActionError } from "@/lib/action-error";
import {
  isStudioBundleTempRef,
  type StudioBundleChangeBaseline,
  type StudioBundleOp,
  type StudioBundleOpOf,
  type StudioBundleSelectionIssue,
  type StudioBundleStoryPatch,
  studioBundleOpCreates,
  studioBundleOpCreators,
  studioBundlePendingDependents,
  studioPlanParentKind,
} from "@/lib/studio/bundle-contract";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioEntryField,
  type StudioPlanKind,
} from "@/lib/studio/contracts";
import { applyFieldOps, normalizeEntryFields } from "@/lib/studio/entry-fields";
import { hashText } from "@/lib/studio/prose-text";

import {
  acceptedBundleRefs,
  listMentions,
  opMentions,
  type StudioStoryRows,
} from "./bundle-kit";
import type { StudioChangeRow } from "./repository";

type Verdict = "ok" | "conflict" | "invalid" | "too-many-fields";

/** True when `itemId` sits somewhere under `ancestorId`. */
function isUnder(
  rows: StudioStoryRows,
  itemId: string,
  ancestorId: string,
): boolean {
  const seen = new Set<string>();
  let parentId = rows.planItems.get(itemId)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    if (parentId === ancestorId) return true;
    seen.add(parentId);
    parentId = rows.planItems.get(parentId)?.parentId ?? null;
  }
  return false;
}

/**
 * Read-back moves a planned change down from a scene into the moment that
 * writes it, so a record now pinned under its baseline item still matches.
 */
function matchesChangeBaseline(
  rows: StudioStoryRows,
  change: StudioChangeRow,
  baseline: StudioBundleChangeBaseline,
): boolean {
  return (
    change.aspect === baseline.aspect &&
    change.mode === baseline.mode &&
    change.value === baseline.value &&
    change.aboutEntryId === baseline.aboutEntryId &&
    (change.planItemId === baseline.planItemId ||
      isUnder(rows, change.planItemId, baseline.planItemId))
  );
}

/**
 * True when the item, anything under it, or their prose or change records
 * were written after `since`.
 */
function subtreeChangedSince(
  rows: StudioStoryRows,
  rootId: string,
  since: string,
): boolean {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of rows.planItems.values()) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  for (const id of ids) {
    if ((rows.planItems.get(id)?.updatedAt ?? "") > since) return true;
    if ((rows.prose.get(id)?.updatedAt ?? "") > since) return true;
  }
  for (const change of rows.changes.values()) {
    if (ids.has(change.planItemId) && change.updatedAt > since) return true;
  }
  return false;
}

/**
 * Checks a selection against the story without writing and reports every
 * problem by op id: temp-id dependencies that are unselected or were
 * dismissed, stale baselines, the field cap, and ops that cannot apply as
 * proposed. A temp id whose create was accepted earlier is checked as the
 * record it became. Deletes also conflict when anything they would remove
 * was written after the op's `baselineAt` (else `proposedAt`, the bundle's
 * createdAt), since prose saves, child adds, reorders and new records do
 * not bump the revision the baseline holds.
 */
export function findBundleSelectionIssues(
  ops: StudioBundleOp[],
  selected: Set<string>,
  rows: StudioStoryRows,
  proposedAt: string,
): StudioBundleSelectionIssue[] {
  const creators = new Map<string, StudioBundleOp>();
  for (const op of ops) {
    const created = studioBundleOpCreates(op);
    if (created) creators.set(created.tempId, op);
  }
  const creatorsOf = studioBundleOpCreators(ops);
  const accepted = acceptedBundleRefs(ops);
  const chosen = ops.filter((op) => selected.has(op.id));

  const issues: StudioBundleSelectionIssue[] = [];
  for (const op of chosen) {
    const needs = (creatorsOf.get(op.id) ?? []).filter(
      (creator) => creator.status === "pending" && !selected.has(creator.id),
    );
    if (needs.length > 0) {
      issues.push({
        opId: op.id,
        label: op.label,
        kind: "missing-dependency",
        needsOpIds: needs.map((need) => need.id),
      });
    }
    if (
      (creatorsOf.get(op.id) ?? []).some(
        (creator) =>
          creator.status === "rejected" || creator.status === "undone",
      )
    ) {
      issues.push({
        opId: op.id,
        label: op.label,
        kind: "dependency-dismissed",
      });
    }
  }

  /** The saved id a ref names now; a temp id while its create is not accepted. */
  const resolve = (ref: string) => accepted.get(ref) ?? ref;
  const entryExists = (ref: string) => {
    const id = resolve(ref);
    return isStudioBundleTempRef(id) || rows.entries.has(id);
  };
  /** The kind of a referenced plan item; null when it no longer exists. */
  const planKind = (ref: string): StudioPlanKind | null => {
    const id = resolve(ref);
    if (!isStudioBundleTempRef(id)) return rows.planItems.get(id)?.kind ?? null;
    const creator = creators.get(id);
    return creator?.kind === "plan.create" ? creator.item.kind : null;
  };
  // Field lists as earlier selected ops in this bundle leave them.
  const simulatedFields = new Map<string, StudioEntryField[]>();

  const verdict = (op: StudioBundleOp): Verdict => {
    const since = op.baselineAt ?? proposedAt;
    switch (op.kind) {
      case "story.update": {
        const keys = Object.keys(op.patch) as (keyof StudioBundleStoryPatch)[];
        return keys.every((key) =>
          isDeepStrictEqual(rows.story[key], op.baseline[key]),
        )
          ? "ok"
          : "conflict";
      }
      case "entry.create": {
        if (!op.entry.relatedEntryRefs.every(entryExists)) return "conflict";
        const fields = applyFieldOps(
          [],
          op.entry.fields.map((field) => ({ op: "set" as const, ...field })),
        );
        return fields.length > STUDIO_MAX_ENTRY_FIELDS
          ? "too-many-fields"
          : "ok";
      }
      case "entry.update": {
        const entry = rows.entries.get(op.entryId);
        if (!entry || entry.revision !== op.baselineRevision) return "conflict";
        const fields =
          simulatedFields.get(entry.id) ??
          normalizeEntryFields(entry.fields, entry.type);
        const next = applyFieldOps(fields, op.patch.fieldOps);
        simulatedFields.set(entry.id, next);
        // An entry already over the cap may still be edited if it does not grow.
        return next.length > STUDIO_MAX_ENTRY_FIELDS &&
          next.length > fields.length
          ? "too-many-fields"
          : "ok";
      }
      case "entry.delete": {
        const entry = rows.entries.get(op.entryId);
        if (entry?.revision !== op.baselineRevision) return "conflict";
        for (const change of rows.changes.values()) {
          if (change.entryId === op.entryId && change.updatedAt > since) {
            return "conflict";
          }
        }
        return "ok";
      }
      case "plan.create": {
        if (!op.item.presentEntryRefs.every(entryExists)) return "conflict";
        if (op.item.parentRef === null) return "ok";
        const parentKind = planKind(op.item.parentRef);
        if (parentKind === null) return "conflict";
        return parentKind === studioPlanParentKind(op.item.kind)
          ? "ok"
          : "invalid";
      }
      case "plan.update": {
        const item = rows.planItems.get(op.itemId);
        if (!item || item.revision !== op.baselineRevision) return "conflict";
        if (!(op.patch.presentEntryIds ?? []).every(entryExists)) {
          return "conflict";
        }
        return "ok";
      }
      case "plan.move": {
        const item = rows.planItems.get(op.itemId);
        if (
          !item ||
          item.revision !== op.baselineRevision ||
          item.parentId !== op.baselineParentId ||
          item.position !== op.baselinePosition
        ) {
          return "conflict";
        }
        const expected = studioPlanParentKind(item.kind);
        if (op.newParentRef === null)
          return expected === null ? "ok" : "invalid";
        const parentKind = planKind(op.newParentRef);
        if (parentKind === null) return "conflict";
        return parentKind === expected ? "ok" : "invalid";
      }
      case "plan.delete": {
        const item = rows.planItems.get(op.itemId);
        return item?.revision === op.baselineRevision &&
          !subtreeChangedSince(rows, op.itemId, since)
          ? "ok"
          : "conflict";
      }
      case "change.create": {
        if (!entryExists(op.entryRef)) return "conflict";
        if (op.aboutEntryRef !== null && !entryExists(op.aboutEntryRef)) {
          return "conflict";
        }
        return planKind(op.planItemRef) === null ? "conflict" : "ok";
      }
      case "change.update": {
        const change = rows.changes.get(op.changeId);
        if (!change || !matchesChangeBaseline(rows, change, op.baseline)) {
          return "conflict";
        }
        const { aboutEntryId, planItemId } = op.patch;
        if (aboutEntryId && !entryExists(aboutEntryId)) return "conflict";
        if (planItemId && planKind(planItemId) === null) return "conflict";
        return "ok";
      }
      case "change.delete": {
        const change = rows.changes.get(op.changeId);
        return change && matchesChangeBaseline(rows, change, op.baseline)
          ? "ok"
          : "conflict";
      }
      case "prose.write": {
        const kind = planKind(op.momentRef);
        if (kind === null) return "conflict";
        if (kind !== "moment") return "invalid";
        const momentId = resolve(op.momentRef);
        if (isStudioBundleTempRef(momentId)) return "ok";
        const prose = rows.prose.get(momentId);
        if ((prose?.revision ?? 0) !== op.baselineRevision) return "conflict";
        return op.baselineHash === "" ||
          hashText(prose?.markdown ?? "") === op.baselineHash
          ? "ok"
          : "conflict";
      }
    }
  };

  for (const op of chosen) {
    const result = verdict(op);
    if (result !== "ok") {
      issues.push({ opId: op.id, label: op.label, kind: result });
    }
  }
  return issues;
}

/**
 * Runs `findBundleSelectionIssues` and throws for the first kind found, with
 * a user-facing message naming the ops by label: BAD_REQUEST for missing or
 * dismissed dependencies, CONFLICT for stale baselines (every conflicting op
 * named), BAD_REQUEST for the field cap and for ops that cannot apply as
 * proposed. The selection check returns the full list by op id.
 */
export function precheckBundleAccept(
  ops: StudioBundleOp[],
  selected: Set<string>,
  rows: StudioStoryRows,
  proposedAt: string,
): void {
  const issues = findBundleSelectionIssues(ops, selected, rows, proposedAt);
  const mentions = opMentions(ops);
  const named = (ids: string[]) =>
    listMentions(ids.map((id) => mentions.get(id) ?? id));
  const ofKind = (kind: StudioBundleSelectionIssue["kind"]) =>
    issues.filter((issue) => issue.kind === kind).map((issue) => issue.opId);

  const pairs = issues.flatMap((issue) =>
    issue.kind === "missing-dependency"
      ? [`${named([issue.opId])} needs ${named(issue.needsOpIds)}`]
      : [],
  );
  if (pairs.length > 0) {
    const more = pairs.length > 4 ? ` and ${pairs.length - 4} more` : "";
    throw new ActionError(
      "BAD_REQUEST",
      `Some selected changes depend on changes that are not selected: ${pairs.slice(0, 4).join("; ")}${more}. Select those too, or deselect these.`,
    );
  }
  const orphaned = ofKind("dependency-dismissed");
  if (orphaned.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `These changes depend on ones that were dismissed or undone: ${named(orphaned)}. Dismiss them instead.`,
    );
  }
  const conflicts = ofKind("conflict");
  if (conflicts.length > 0) {
    throw new ActionError(
      "CONFLICT",
      `The story changed after these were proposed: ${named(conflicts)}. Deselect them to accept the rest.`,
    );
  }
  const tooManyFields = ofKind("too-many-fields");
  if (tooManyFields.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `${named(tooManyFields)} would leave an entry with more than ${STUDIO_MAX_ENTRY_FIELDS} fields. Deselect them to accept the rest.`,
    );
  }
  const invalid = ofKind("invalid");
  if (invalid.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `These changes can't be applied as proposed: ${named(invalid)}. Deselect them to accept the rest.`,
    );
  }
}

/**
 * The pending ops with no issues against `rows`, all pending ops taken
 * together (so pending creates count as selected). Accept and undo compute
 * this before writing: only these ops are rebased afterwards.
 */
export function findCleanPendingOps(
  ops: StudioBundleOp[],
  rows: StudioStoryRows,
  proposedAt: string,
): Set<string> {
  const pending = new Set(
    ops.filter((op) => op.status === "pending").map((op) => op.id),
  );
  const flagged = new Set(
    findBundleSelectionIssues(ops, pending, rows, proposedAt).map(
      (issue) => issue.opId,
    ),
  );
  return new Set([...pending].filter((id) => !flagged.has(id)));
}

function rebaseOp(
  op: StudioBundleOp,
  rows: StudioStoryRows,
  refs: Map<string, string>,
): StudioBundleOp {
  switch (op.kind) {
    case "story.update": {
      const baseline: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) {
        baseline[key] = rows.story[key as keyof StudioBundleStoryPatch];
      }
      return { ...op, baseline: baseline as StudioBundleStoryPatch };
    }
    case "entry.update":
    case "entry.delete": {
      const entry = rows.entries.get(op.entryId);
      return entry ? { ...op, baselineRevision: entry.revision } : op;
    }
    case "plan.update":
    case "plan.delete": {
      const item = rows.planItems.get(op.itemId);
      return item ? { ...op, baselineRevision: item.revision } : op;
    }
    case "plan.move": {
      const item = rows.planItems.get(op.itemId);
      return item
        ? {
            ...op,
            baselineRevision: item.revision,
            baselineParentId: item.parentId,
            baselinePosition: item.position,
          }
        : op;
    }
    case "change.update":
    case "change.delete": {
      const change = rows.changes.get(op.changeId);
      return change
        ? {
            ...op,
            baseline: {
              aspect: change.aspect,
              mode: change.mode,
              value: change.value,
              aboutEntryId: change.aboutEntryId,
              planItemId: change.planItemId,
            },
          }
        : op;
    }
    case "prose.write": {
      const momentId = refs.get(op.momentRef) ?? op.momentRef;
      if (isStudioBundleTempRef(momentId) || !rows.planItems.has(momentId)) {
        return op;
      }
      const prose = rows.prose.get(momentId);
      return {
        ...op,
        baselineRevision: prose?.revision ?? 0,
        baselineHash:
          op.baselineHash === "" ? "" : hashText(prose?.markdown ?? ""),
      };
    }
    default:
      return op;
  }
}

/**
 * Rewrites the baselines of `opIds` from `rows`, the story right after an
 * accept or undo of other ops in the same bundle wrote it, and stamps
 * `baselineAt` (taken after those writes), so the bundle's own writes never
 * read as conflicts later. Pass only `findCleanPendingOps` from before the
 * write: an op that already conflicted keeps its old baselines. `ops` must
 * carry this write's results, so a temp moment ref can resolve.
 */
export function rebaseBundleOps(
  ops: StudioBundleOp[],
  opIds: Set<string>,
  rows: StudioStoryRows,
  baselineAt: string,
): StudioBundleOp[] {
  const refs = acceptedBundleRefs(ops);
  return ops.map((op) =>
    opIds.has(op.id) && op.status === "pending"
      ? { ...rebaseOp(op, rows, refs), baselineAt }
      : op,
  );
}

/** The saved records an op writes, or creates something inside. */
function opTargets(
  op: StudioBundleOp,
  refs: Map<string, string>,
): { planItemIds: string[]; entryIds: string[]; changeIds: string[] } {
  const resolve = (ref: string) => refs.get(ref) ?? ref;
  const none = { planItemIds: [], entryIds: [], changeIds: [] };
  switch (op.kind) {
    case "entry.update":
    case "entry.delete":
      return { ...none, entryIds: [op.entryId] };
    case "plan.create":
      return op.item.parentRef === null
        ? none
        : { ...none, planItemIds: [resolve(op.item.parentRef)] };
    case "plan.update":
    case "plan.move":
    case "plan.delete":
      return { ...none, planItemIds: [op.itemId] };
    case "change.create":
      return {
        ...none,
        planItemIds: [resolve(op.planItemRef)],
        entryIds: [resolve(op.entryRef)],
      };
    case "change.update":
    case "change.delete":
      return { ...none, changeIds: [op.changeId] };
    case "prose.write":
      return { ...none, planItemIds: [resolve(op.momentRef)] };
    default:
      return none;
  }
}

/**
 * Pending ops whose target an accept just removed (something inside an
 * accepted plan.delete's subtree, an accepted entry.delete's entry and its
 * records, a deleted change record), plus the pending ops that depend on
 * them. They can never apply, so accept dismisses them instead of leaving
 * them to read as conflicts. `ops` must carry the accept's results.
 */
export function findOrphanedPendingOps(
  ops: StudioBundleOp[],
  before: StudioStoryRows,
  after: StudioStoryRows,
): Set<string> {
  const refs = acceptedBundleRefs(ops);
  const removed = <T>(was: Map<string, T>, now: Map<string, T>, id: string) =>
    was.has(id) && !now.has(id);
  const orphaned = new Set<string>();
  for (const op of ops) {
    if (op.status !== "pending") continue;
    const targets = opTargets(op, refs);
    if (
      targets.planItemIds.some((id) =>
        removed(before.planItems, after.planItems, id),
      ) ||
      targets.entryIds.some((id) =>
        removed(before.entries, after.entries, id),
      ) ||
      targets.changeIds.some((id) => removed(before.changes, after.changes, id))
    ) {
      orphaned.add(op.id);
    }
  }
  for (const id of studioBundlePendingDependents(ops, orphaned)) {
    orphaned.add(id);
  }
  return orphaned;
}

const APPLY_RANK: Record<StudioBundleOp["kind"], number> = {
  "story.update": 0,
  "entry.create": 1,
  "entry.update": 2,
  "plan.create": 3,
  "plan.update": 4,
  "plan.move": 4,
  "change.create": 5,
  "change.update": 5,
  "prose.write": 6,
  // Deletes run last: records first, then plan items (deepest first, so an
  // item inside a deleted one is snapshotted on its own), then entries.
  "change.delete": 7,
  "plan.delete": 8,
  "entry.delete": 9,
};

/** New plan items after the new items they nest in or follow. */
function orderPlanCreates(
  ops: StudioBundleOpOf<"plan.create">[],
): StudioBundleOpOf<"plan.create">[] {
  const byTemp = new Map(ops.map((op) => [op.tempId, op]));
  const done = new Set<string>();
  const ordered: StudioBundleOpOf<"plan.create">[] = [];
  const visit = (op: StudioBundleOpOf<"plan.create">, path: Set<string>) => {
    if (done.has(op.tempId)) return;
    if (path.has(op.tempId)) {
      throw new ActionError(
        "BAD_REQUEST",
        `“${op.label}” is placed in a loop of new items.`,
      );
    }
    path.add(op.tempId);
    for (const ref of [op.item.parentRef, op.item.afterRef]) {
      const dependency = ref === null ? undefined : byTemp.get(ref);
      if (dependency) visit(dependency, path);
    }
    path.delete(op.tempId);
    done.add(op.tempId);
    ordered.push(op);
  };
  for (const op of ops) visit(op, new Set());
  return ordered;
}

function planDepth(rows: StudioStoryRows, itemId: string): number {
  let depth = 0;
  let parentId = rows.planItems.get(itemId)?.parentId ?? null;
  while (parentId !== null && depth < 3) {
    depth += 1;
    parentId = rows.planItems.get(parentId)?.parentId ?? null;
  }
  return depth;
}

/**
 * Apply order: story, entry creates, entry updates, plan creates (parents
 * and earlier siblings first), plan updates and moves, change records,
 * prose, then deletes. Bundle order is kept within each group.
 */
export function orderBundleOpsForApply(
  selected: StudioBundleOp[],
  rows: StudioStoryRows,
): StudioBundleOp[] {
  const groups: StudioBundleOp[][] = Array.from({ length: 10 }, () => []);
  for (const op of selected) groups[APPLY_RANK[op.kind]].push(op);
  groups[APPLY_RANK["plan.create"]] = orderPlanCreates(
    selected.filter(
      (op): op is StudioBundleOpOf<"plan.create"> => op.kind === "plan.create",
    ),
  );
  groups[APPLY_RANK["plan.delete"]] = selected
    .filter(
      (op): op is StudioBundleOpOf<"plan.delete"> => op.kind === "plan.delete",
    )
    .map((op, index) => ({ op, index, depth: planDepth(rows, op.itemId) }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map(({ op }) => op);
  return groups.flat();
}
