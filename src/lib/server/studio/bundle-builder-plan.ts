import "server-only";

import { isDeepStrictEqual } from "node:util";

import { STUDIO_CRAFT_FIELDS } from "@/lib/studio/bible-templates";
import {
  isStudioBundleTempRef,
  type StudioBundleOpInput,
  studioBundleOpRefs,
  studioPlanParentKind,
} from "@/lib/studio/bundle-contract";
import type { StudioPlanKind } from "@/lib/studio/contracts";

import {
  type BuilderDraft,
  type OpOf,
  quoted,
  TEMP_ID_PATTERN,
} from "./bundle-draft";

/**
 * Plan items for the chat's bundle candidate (see bundle-builder-ops.ts for
 * the conventions). New items get temp ids the model chooses; a parent or
 * sibling must be listed before the items that refer to it. Edits of an
 * item created this turn merge into its create; repeated edits or moves of
 * a saved item merge into one op that keeps the first-seen baseline.
 */

export type PlanItemInput = {
  op: "create" | "update" | "move" | "delete";
  itemId: string | null;
  tempId: string | null;
  kind: StudioPlanKind | null;
  parentId: string | null;
  afterId: string | null;
  newIndex: number | null;
  title: string | null;
  whatHappens: string | null;
  howToWrite: string | null;
  craft: { key: string; value: string }[] | null;
  presentEntryIds: string[] | null;
  tension: number | null;
};

const MAX_PRESENT = 100;

type PlanText = { title: string; whatHappens: string; howToWrite: string };

function planLabel(verb: string, kind: StudioPlanKind, title: string): string {
  return `${verb} ${kind} ${quoted(title, "Untitled")}`;
}

/** Validates title/whatHappens/howToWrite; returns only the given ones. */
function planText(
  draft: BuilderDraft,
  index: number,
  item: PlanItemInput,
): Partial<PlanText> | null {
  const text: Partial<PlanText> = {};
  if (item.title !== null) {
    const title = item.title.trim().replace(/\s+/g, " ");
    if (title.length > 200) {
      draft.fail(index, "title must be at most 200 characters");
      return null;
    }
    text.title = title;
  }
  for (const key of ["whatHappens", "howToWrite"] as const) {
    const value = item[key];
    if (value === null) continue;
    if (value.length > 20_000) {
      draft.fail(index, `${key} must be at most 20,000 characters`);
      return null;
    }
    text[key] = value.trim();
  }
  return text;
}

/** Craft keys are fixed per kind; an empty value clears a key. */
function mergeCraft(
  draft: BuilderDraft,
  index: number,
  kind: StudioPlanKind,
  edits: { key: string; value: string }[],
  base: Record<string, string>,
): Record<string, string> | null {
  const allowed = STUDIO_CRAFT_FIELDS[kind].map((field) => field.key);
  const next = { ...base };
  for (const edit of edits) {
    const key = edit.key.trim();
    if (!allowed.includes(key)) {
      draft.fail(
        index,
        `craft key "${key}" is not used on a ${kind}; use ${allowed.join(", ")}`,
      );
      return null;
    }
    const value = edit.value.trim();
    if (value.length > 2000) {
      draft.fail(index, `craft ${key} must be at most 2,000 characters`);
      return null;
    }
    if (value) next[key] = value;
    else delete next[key];
  }
  return next;
}

function presentRefs(
  draft: BuilderDraft,
  index: number,
  refs: string[],
): string[] | null {
  const unique = [...new Set(refs.map((ref) => ref.trim()))];
  if (unique.length > MAX_PRESENT) {
    draft.fail(index, `at most ${MAX_PRESENT} present entries`);
    return null;
  }
  draft.defer(() => {
    for (const ref of unique) {
      const resolved = draft.entry(ref);
      if (!resolved.ok) draft.fail(index, resolved.error);
    }
  });
  return unique;
}

function requireNull(
  draft: BuilderDraft,
  index: number,
  item: PlanItemInput,
  keys: (keyof PlanItemInput)[],
  why: string,
): boolean {
  const set = keys.filter((key) => item[key] !== null);
  if (set.length === 0) return true;
  draft.fail(index, `${set.join(", ")} must be null here: ${why}`);
  return false;
}

/** The parent a new or moved item of `kind` goes under, checked by kind. */
function parentFor(
  draft: BuilderDraft,
  index: number,
  kind: StudioPlanKind,
  parentId: string | null,
): { ok: true; ref: string | null } | { ok: false } {
  const expected = studioPlanParentKind(kind);
  if (expected === null) {
    if (parentId !== null) {
      draft.fail(
        index,
        "chapters sit at the top level, so parentId must be null",
      );
      return { ok: false };
    }
    return { ok: true, ref: null };
  }
  const parent = draft.planItem(parentId);
  if (!parent.ok) {
    draft.fail(index, `parentId: ${parent.error}`);
    return { ok: false };
  }
  if (parent.value.kind !== expected) {
    draft.fail(
      index,
      `a ${kind} goes under a ${expected}, but ${parent.value.ref} is a ${parent.value.kind}`,
    );
    return { ok: false };
  }
  return { ok: true, ref: parent.value.ref };
}

function createItem(draft: BuilderDraft, item: PlanItemInput, index: number) {
  if (
    !requireNull(
      draft,
      index,
      item,
      ["itemId", "newIndex", "tension"],
      "create places the item with parentId and afterId; set tension later on a saved chapter",
    )
  ) {
    return;
  }
  const tempId = item.tempId?.trim() ?? "";
  if (!TEMP_ID_PATTERN.test(tempId)) {
    return draft.fail(
      index,
      "create needs a tempId like new:short-name (letters, digits, _ . - only)",
    );
  }
  if (
    draft.find("plan.create", (op) => op.tempId === tempId) ||
    draft.find("entry.create", (op) => op.tempId === tempId)
  ) {
    return draft.fail(index, `tempId ${tempId} is already used in this turn`);
  }
  if (item.kind === null) return draft.fail(index, "create needs a kind");
  const kind = item.kind;
  const parent = parentFor(draft, index, kind, item.parentId);
  if (!parent.ok) return;
  let afterRef: string | null = null;
  if (item.afterId !== null) {
    const after = draft.planItem(item.afterId);
    if (!after.ok) return draft.fail(index, `afterId: ${after.error}`);
    if (after.value.kind !== kind || after.value.parentRef !== parent.ref) {
      return draft.fail(
        index,
        "afterId must be a sibling of the same kind under the same parent",
      );
    }
    afterRef = after.value.ref;
  }
  const text = planText(draft, index, item);
  if (!text) return;
  const craft = mergeCraft(draft, index, kind, item.craft ?? [], {});
  if (!craft) return;
  const present = presentRefs(draft, index, item.presentEntryIds ?? []);
  if (!present) return;
  const title = text.title ?? "";
  draft.addOp<OpOf<"plan.create">>(
    {
      kind: "plan.create",
      label: planLabel("Add", kind, title),
      tempId,
      item: {
        kind,
        parentRef: parent.ref,
        afterRef,
        title,
        whatHappens: text.whatHappens ?? "",
        howToWrite: text.howToWrite ?? "",
        craft,
        presentEntryRefs: present,
      },
    },
    tempId,
  );
}

function updateNewItem(
  draft: BuilderDraft,
  item: PlanItemInput,
  index: number,
  create: OpOf<"plan.create">,
) {
  if (
    !requireNull(
      draft,
      index,
      item,
      ["parentId", "afterId", "newIndex", "tension"],
      "an item new in this turn keeps the place its create gave it, and tension is set on saved chapters only",
    )
  ) {
    return;
  }
  if (item.kind !== null && item.kind !== create.item.kind) {
    return draft.fail(index, "an item's kind cannot change");
  }
  const text = planText(draft, index, item);
  if (!text) return;
  const next = { ...create.item, ...text };
  if (item.craft !== null) {
    const craft = mergeCraft(draft, index, next.kind, item.craft, next.craft);
    if (!craft) return;
    next.craft = craft;
  }
  if (item.presentEntryIds !== null) {
    const present = presentRefs(draft, index, item.presentEntryIds);
    if (!present) return;
    next.presentEntryRefs = present;
  }
  create.item = next;
  create.label = planLabel("Add", next.kind, next.title);
  draft.markChanged(create);
}

function updateItem(draft: BuilderDraft, item: PlanItemInput, index: number) {
  const id = item.itemId?.trim() ?? "";
  if (!id) return draft.fail(index, "update needs itemId");
  if (item.tempId !== null) {
    return draft.fail(index, "update takes itemId; tempId is only for create");
  }
  if (isStudioBundleTempRef(id)) {
    const create = draft.find("plan.create", (op) => op.tempId === id);
    if (!create) {
      return draft.fail(
        index,
        `no plan item with id ${id} is proposed in this turn`,
      );
    }
    return updateNewItem(draft, item, index, create);
  }
  const resolved = draft.planItem(id);
  if (!resolved.ok) return draft.fail(index, resolved.error);
  const saved = draft.snap.items.get(id);
  if (!saved) return draft.fail(index, `there is no plan item with id ${id}`);
  if (
    !requireNull(
      draft,
      index,
      item,
      ["parentId", "afterId", "newIndex"],
      "to move an item, use op move",
    )
  ) {
    return;
  }
  if (item.kind !== null && item.kind !== saved.kind) {
    return draft.fail(index, "an item's kind cannot change");
  }
  const op = draft.find("plan.update", (candidate) => candidate.itemId === id);
  const patch: OpOf<"plan.update">["patch"] = { ...(op?.patch ?? {}) };
  const text = planText(draft, index, item);
  if (!text) return;
  Object.assign(patch, text);
  if (item.craft !== null) {
    const craft = mergeCraft(
      draft,
      index,
      saved.kind,
      item.craft,
      patch.craft ?? saved.craft,
    );
    if (!craft) return;
    patch.craft = craft;
  }
  if (item.presentEntryIds !== null) {
    const present = presentRefs(draft, index, item.presentEntryIds);
    if (!present) return;
    patch.presentEntryIds = present;
  }
  if (item.tension !== null) {
    if (saved.kind !== "chapter") {
      return draft.fail(index, "tension is only set on chapters");
    }
    if (
      !Number.isInteger(item.tension) ||
      item.tension < 1 ||
      item.tension > 10
    ) {
      return draft.fail(index, "tension must be a whole number from 1 to 10");
    }
    patch.tension = item.tension;
  }
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    if (isDeepStrictEqual(patch[key], saved[key])) delete patch[key];
  }
  if (Object.keys(patch).length === 0) {
    if (op) {
      draft.removeOp(
        op,
        `The edit of ${saved.kind} ${quoted(saved.title, "Untitled")} now matches what is saved, so it was dropped.`,
      );
      return;
    }
    return draft.fail(index, "this update changes nothing");
  }
  if (op) {
    op.patch = patch;
    draft.markChanged(op);
    return;
  }
  draft.addOp<OpOf<"plan.update">>(
    {
      kind: "plan.update",
      label: planLabel("Edit", saved.kind, saved.title),
      itemId: id,
      baselineRevision: saved.revision,
      patch,
    },
    id,
  );
}

function moveItem(draft: BuilderDraft, item: PlanItemInput, index: number) {
  const id = item.itemId?.trim() ?? "";
  if (!id) return draft.fail(index, "move needs itemId");
  if (isStudioBundleTempRef(id)) {
    return draft.fail(
      index,
      `${id} is new in this turn; place it with parentId and afterId when creating it`,
    );
  }
  if (
    !requireNull(
      draft,
      index,
      item,
      [
        "tempId",
        "afterId",
        "title",
        "whatHappens",
        "howToWrite",
        "craft",
        "presentEntryIds",
        "tension",
      ],
      "a move carries only itemId, parentId, and newIndex; edit with a separate update item",
    )
  ) {
    return;
  }
  const resolved = draft.planItem(id);
  if (!resolved.ok) return draft.fail(index, resolved.error);
  const saved = draft.snap.items.get(id);
  if (!saved) return draft.fail(index, `there is no plan item with id ${id}`);
  if (item.kind !== null && item.kind !== saved.kind) {
    return draft.fail(index, "an item's kind cannot change");
  }
  const parent = parentFor(draft, index, saved.kind, item.parentId);
  if (!parent.ok) return;
  const newIndex = item.newIndex;
  if (newIndex === null || !Number.isInteger(newIndex) || newIndex < 0) {
    return draft.fail(index, "move needs newIndex, a whole number from 0");
  }
  const op = draft.find("plan.move", (candidate) => candidate.itemId === id);
  if (op) {
    op.newParentRef = parent.ref;
    op.newIndex = newIndex;
    draft.markChanged(op);
    return;
  }
  draft.addOp<OpOf<"plan.move">>(
    {
      kind: "plan.move",
      label: planLabel("Move", saved.kind, saved.title),
      itemId: id,
      baselineRevision: saved.revision,
      baselineParentId: saved.parentId,
      baselinePosition: saved.position,
      newParentRef: parent.ref,
      newIndex,
    },
    id,
  );
}

/** Plan refs an op points at or targets (its own item included). */
function planTargets(op: StudioBundleOpInput): string[] {
  const { planRefs } = studioBundleOpRefs(op);
  if (op.kind === "plan.update" || op.kind === "plan.move") {
    return [op.itemId, ...planRefs];
  }
  return planRefs;
}

function deleteItem(draft: BuilderDraft, item: PlanItemInput, index: number) {
  const id = item.itemId?.trim() ?? "";
  if (!id) return draft.fail(index, "delete needs itemId");
  if (isStudioBundleTempRef(id)) {
    return draft.fail(
      index,
      `${id} is new in this turn and cannot also be deleted`,
    );
  }
  const saved = draft.snap.items.get(id);
  if (!saved) return draft.fail(index, `there is no plan item with id ${id}`);
  if (draft.find("plan.delete", (op) => op.itemId === id)) {
    return draft.fail(index, `${id} is already proposed for deletion`);
  }
  if (draft.isDeletedPlanRef(id)) {
    return draft.fail(
      index,
      `${id} sits inside an item already proposed for deletion`,
    );
  }
  // Edits of the item itself and deletes inside it are covered by this one.
  for (const op of [...draft.state.ops]) {
    if (
      (op.kind === "plan.update" || op.kind === "plan.move") &&
      op.itemId === id
    ) {
      draft.removeOp(
        op,
        `“${op.label}” was dropped because the ${saved.kind} is now proposed for deletion.`,
      );
    } else if (
      op.kind === "plan.delete" &&
      draft.savedChain(op.itemId).includes(id)
    ) {
      draft.removeOp(
        op,
        `“${op.label}” was dropped because deleting the ${saved.kind} removes it too.`,
      );
    }
  }
  draft.addOp<OpOf<"plan.delete">>(
    {
      kind: "plan.delete",
      label: planLabel("Delete", saved.kind, saved.title),
      itemId: id,
      baselineRevision: saved.revision,
    },
    id,
  );
  const users = draft.state.ops.filter((op) => {
    if (op.kind === "change.update" || op.kind === "change.delete") {
      const row = draft.snap.rows.changes.get(op.changeId);
      if (row && draft.isDeletedPlanRef(row.planItemId)) return true;
    }
    return planTargets(op).some((ref) => draft.isDeletedPlanRef(ref));
  });
  if (users.length > 0) {
    draft.fail(
      index,
      `other proposed changes still use this ${saved.kind} or something inside it: ${users
        .map((op) => `“${op.label}”`)
        .join(", ")}`,
    );
  }
}

export function proposePlan(draft: BuilderDraft, items: PlanItemInput[]): void {
  if (items.length === 0) draft.errors.push("items is empty");
  items.forEach((item, index) => {
    if (item.op === "create") createItem(draft, item, index);
    else if (item.op === "update") updateItem(draft, item, index);
    else if (item.op === "move") moveItem(draft, item, index);
    else deleteItem(draft, item, index);
  });
}
