import "server-only";

import { isDeepStrictEqual } from "node:util";

import { ActionError } from "@/lib/action-error";
import {
  isStudioBundleTempRef,
  type StudioBundleChangeBaseline,
  type StudioBundleOp,
  type StudioBundleOpOf,
  type StudioBundleSelectionIssues,
  type StudioBundleStoryPatch,
  studioBundleOpCreates,
  studioBundleOpRefs,
  studioPlanParentKind,
} from "@/lib/studio/bundle-contract";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioEntryField,
  type StudioPlanKind,
} from "@/lib/studio/contracts";
import { applyFieldOps, normalizeEntryFields } from "@/lib/studio/entry-fields";
import { hashText } from "@/lib/studio/prose-text";

import { quoteOpLabels, type StudioStoryRows } from "./bundle-kit";
import type { StudioChangeRow } from "./repository";

type Verdict = "ok" | "conflict" | "invalid" | "too-many-fields";

function matchesChangeBaseline(
  change: StudioChangeRow,
  baseline: StudioBundleChangeBaseline,
): boolean {
  return (
    change.aspect === baseline.aspect &&
    change.mode === baseline.mode &&
    change.value === baseline.value &&
    change.aboutEntryId === baseline.aboutEntryId &&
    change.planItemId === baseline.planItemId
  );
}

/**
 * Checks a selection against the story without writing: which selected ops
 * need a temp id from an unselected op, whose baseline no longer matches,
 * which would push an entry past the field cap, and which cannot apply as
 * proposed (wrong nesting). Ids only, so a caller can mark the ops.
 */
export function findBundleSelectionIssues(
  ops: StudioBundleOp[],
  selected: Set<string>,
  rows: StudioStoryRows,
): StudioBundleSelectionIssues {
  const creators = new Map<string, StudioBundleOp>();
  for (const op of ops) {
    const created = studioBundleOpCreates(op);
    if (created) creators.set(created.tempId, op);
  }
  const chosen = ops.filter((op) => selected.has(op.id));

  const missingDependencies: StudioBundleSelectionIssues["missingDependencies"] =
    [];
  for (const op of chosen) {
    const { entryRefs, planRefs } = studioBundleOpRefs(op);
    const needs = [...entryRefs, ...planRefs]
      .filter(isStudioBundleTempRef)
      .map((ref) => creators.get(ref))
      .filter(
        (creator): creator is StudioBundleOp =>
          creator !== undefined && !selected.has(creator.id),
      );
    if (needs.length > 0) {
      missingDependencies.push({
        opId: op.id,
        needsOpIds: [...new Set(needs.map((need) => need.id))],
      });
    }
  }

  const entryExists = (ref: string) =>
    isStudioBundleTempRef(ref) || rows.entries.has(ref);
  /** The kind of a referenced plan item; null when it no longer exists. */
  const planKind = (ref: string): StudioPlanKind | null => {
    if (!isStudioBundleTempRef(ref))
      return rows.planItems.get(ref)?.kind ?? null;
    const creator = creators.get(ref);
    return creator?.kind === "plan.create" ? creator.item.kind : null;
  };
  // Field lists as earlier selected ops in this bundle leave them.
  const simulatedFields = new Map<string, StudioEntryField[]>();

  const verdict = (op: StudioBundleOp): Verdict => {
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
        return entry?.revision === op.baselineRevision ? "ok" : "conflict";
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
        return op.patch.tension != null && item.kind !== "chapter"
          ? "invalid"
          : "ok";
      }
      case "plan.move": {
        const item = rows.planItems.get(op.itemId);
        if (!item || item.revision !== op.baselineRevision) return "conflict";
        const expected = studioPlanParentKind(item.kind);
        if (op.newParentRef === null)
          return expected === null ? "ok" : "invalid";
        const parentKind = planKind(op.newParentRef);
        if (parentKind === null) return "conflict";
        return parentKind === expected ? "ok" : "invalid";
      }
      case "plan.delete": {
        const item = rows.planItems.get(op.itemId);
        return item?.revision === op.baselineRevision ? "ok" : "conflict";
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
        if (!change || !matchesChangeBaseline(change, op.baseline)) {
          return "conflict";
        }
        const { aboutEntryId, planItemId } = op.patch;
        if (aboutEntryId && !entryExists(aboutEntryId)) return "conflict";
        if (planItemId && planKind(planItemId) === null) return "conflict";
        return "ok";
      }
      case "change.delete": {
        const change = rows.changes.get(op.changeId);
        return change && matchesChangeBaseline(change, op.baseline)
          ? "ok"
          : "conflict";
      }
      case "prose.write": {
        const kind = planKind(op.momentRef);
        if (kind === null) return "conflict";
        if (kind !== "moment") return "invalid";
        if (isStudioBundleTempRef(op.momentRef)) return "ok";
        const prose = rows.prose.get(op.momentRef);
        if ((prose?.revision ?? 0) !== op.baselineRevision) return "conflict";
        return op.baselineHash === "" ||
          hashText(prose?.markdown ?? "") === op.baselineHash
          ? "ok"
          : "conflict";
      }
    }
  };

  const issues: StudioBundleSelectionIssues = {
    missingDependencies,
    conflicts: [],
    tooManyFields: [],
    invalid: [],
  };
  for (const op of chosen) {
    const result = verdict(op);
    if (result === "conflict") issues.conflicts.push(op.id);
    if (result === "too-many-fields") issues.tooManyFields.push(op.id);
    if (result === "invalid") issues.invalid.push(op.id);
  }
  return issues;
}

/**
 * Runs `findBundleSelectionIssues` and throws for the first kind found, with
 * a user-facing message naming the ops by label: BAD_REQUEST for missing
 * dependencies, CONFLICT for stale baselines (every conflicting op named),
 * BAD_REQUEST for the field cap and for ops that cannot apply as proposed.
 */
export function precheckBundleAccept(
  ops: StudioBundleOp[],
  selected: Set<string>,
  rows: StudioStoryRows,
): void {
  const issues = findBundleSelectionIssues(ops, selected, rows);
  const labelOf = new Map(ops.map((op) => [op.id, op.label]));
  const labels = (ids: string[]) =>
    quoteOpLabels(ids.map((id) => labelOf.get(id) ?? id));
  if (issues.missingDependencies.length > 0) {
    const pairs = issues.missingDependencies.map(
      ({ opId, needsOpIds }) => `${labels([opId])} needs ${labels(needsOpIds)}`,
    );
    const more = pairs.length > 4 ? ` and ${pairs.length - 4} more` : "";
    throw new ActionError(
      "BAD_REQUEST",
      `Some selected changes depend on changes that are not selected: ${pairs.slice(0, 4).join("; ")}${more}. Select those too, or deselect these.`,
    );
  }
  if (issues.conflicts.length > 0) {
    throw new ActionError(
      "CONFLICT",
      `The story changed after these were proposed: ${labels(issues.conflicts)}. Deselect them to accept the rest.`,
    );
  }
  if (issues.tooManyFields.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `${labels(issues.tooManyFields)} would leave an entry with more than ${STUDIO_MAX_ENTRY_FIELDS} fields. Deselect them to accept the rest.`,
    );
  }
  if (issues.invalid.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `These changes can't be applied as proposed: ${labels(issues.invalid)}. Deselect them to accept the rest.`,
    );
  }
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
        `${quoteOpLabels([op.label])} is placed in a loop of new items.`,
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
