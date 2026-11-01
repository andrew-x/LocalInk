import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioChanges, studioEntries } from "@/lib/drizzle/schema";
import { cleanAspectLabel } from "@/lib/studio/aspects";
import {
  isStudioBundleTempRef,
  type StudioBundleOp,
  type StudioBundleOpKind,
  type StudioBundleOpOf,
  type StudioBundleStoryPatch,
} from "@/lib/studio/bundle-contract";
import { applyFieldOps, normalizeEntryFields } from "@/lib/studio/entry-fields";

import {
  type BundleApplyContext,
  pickKeys,
  resolveRef,
  type StudioBundleOpResults,
  type StudioChangeFields,
  type StudioEntryContent,
} from "./bundle-kit";
import {
  listSiblingRows,
  requireEntry,
  requirePlanItem,
  requireStudioStory,
  type StudioChangeRow,
  type StudioDeletedSubtree,
} from "./repository";
import {
  insertStudioChange,
  insertStudioEntry,
  patchStudioChange,
  patchStudioEntry,
  patchStudioStory,
  removeStudioChange,
  removeStudioEntryWithSnapshot,
  type StudioEntryPatch,
} from "./repository-bible";
import {
  insertPlanItem,
  movePlanItem,
  patchPlanItem,
  removePlanSubtree,
  type StudioPlanItemPatch,
} from "./repository-plan";
import { getProseRow, replaceMomentProse } from "./repository-prose";

type Result<K extends StudioBundleOpKind> = StudioBundleOpResults[K];

export function requireChange(
  tx: LocalinkTx,
  storyId: string,
  changeId: string,
): StudioChangeRow {
  const change = tx
    .select()
    .from(studioChanges)
    .where(
      and(eq(studioChanges.id, changeId), eq(studioChanges.storyId, storyId)),
    )
    .get();
  if (!change) {
    throw new ActionError("BAD_REQUEST", "The change could not be found.");
  }
  return change;
}

function applyStoryUpdate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"story.update">,
): Result<"story.update"> {
  const story = requireStudioStory(tx, ctx.storyId);
  const keys = Object.keys(op.patch) as (keyof StudioBundleStoryPatch)[];
  const before = pickKeys(story, keys);
  patchStudioStory(tx, ctx.storyId, op.patch);
  return { before, after: op.patch };
}

/** New entries and their fields are AI-written. */
function applyEntryCreate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"entry.create">,
): Result<"entry.create"> {
  const fields = applyFieldOps(
    [],
    op.entry.fields.map((field) => ({ op: "set" as const, ...field })),
  );
  const refs = op.entry.relatedEntryRefs.filter((ref) => ref !== op.tempId);
  const waiting = refs.some(
    (ref) => isStudioBundleTempRef(ref) && !ctx.refs.has(ref),
  );
  const entry = insertStudioEntry(tx, {
    storyId: ctx.storyId,
    type: op.entry.type,
    name: op.entry.name,
    summary: op.entry.summary,
    customTypeLabel: op.entry.customTypeLabel,
    relatedEntryIds: waiting ? [] : refs.map((ref) => resolveRef(ctx, ref)),
    fields,
    fieldAuthor: "ai",
  });
  ctx.refs.set(op.tempId, entry.id);
  if (waiting) ctx.deferredRelated.push({ entryId: entry.id, refs });
  return {
    createdId: entry.id,
    after: { name: entry.name, summary: entry.summary, fields: entry.fields },
  };
}

/** Edited fields keep their author; new labels arrive as AI fields. */
function applyEntryUpdate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"entry.update">,
): Result<"entry.update"> {
  const current = requireEntry(tx, ctx.storyId, op.entryId);
  const currentFields = normalizeEntryFields(current.fields, current.type);
  const patch: StudioEntryPatch = {};
  const before: Partial<StudioEntryContent> = {};
  if (op.patch.name !== undefined) {
    patch.name = op.patch.name;
    before.name = current.name;
  }
  if (op.patch.summary !== undefined) {
    patch.summary = op.patch.summary;
    before.summary = current.summary;
  }
  if (op.patch.fieldOps.length > 0) {
    patch.fields = applyFieldOps(currentFields, op.patch.fieldOps);
    before.fields = currentFields;
  }
  const entry = patchStudioEntry(tx, {
    storyId: ctx.storyId,
    entryId: op.entryId,
    expectedRevision: current.revision,
    patch,
    stampAuthors: false,
  });
  const keys = Object.keys(before) as (keyof StudioEntryContent)[];
  return { entryId: op.entryId, before, after: pickKeys(entry, keys) };
}

function applyPlanCreate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"plan.create">,
): Result<"plan.create"> {
  const parentId =
    op.item.parentRef === null ? null : resolveRef(ctx, op.item.parentRef);
  let afterItemId =
    op.item.afterRef === null ? null : resolveRef(ctx, op.item.afterRef);
  // The sibling it should follow may have moved or gone; append instead.
  if (
    afterItemId !== null &&
    !listSiblingRows(tx, ctx.storyId, parentId).some(
      (row) => row.id === afterItemId,
    )
  ) {
    afterItemId = null;
  }
  const { item } = insertPlanItem(tx, {
    storyId: ctx.storyId,
    kind: op.item.kind,
    parentId,
    afterItemId,
    title: op.item.title,
    now: ctx.now,
    origin: "ai",
    content: {
      whatHappens: op.item.whatHappens,
      howToWrite: op.item.howToWrite,
      craft: op.item.craft,
      presentEntryIds: [
        ...new Set(op.item.presentEntryRefs.map((ref) => resolveRef(ctx, ref))),
      ],
    },
  });
  ctx.refs.set(op.tempId, item.id);
  return {
    createdId: item.id,
    after: {
      whatHappens: item.whatHappens,
      howToWrite: item.howToWrite,
      craft: item.craft,
    },
  };
}

/** Accepted edits keep each field's ownership (`authorFields` unchanged). */
function applyPlanUpdate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"plan.update">,
): Result<"plan.update"> {
  const current = requirePlanItem(tx, ctx.storyId, op.itemId);
  const patch: StudioPlanItemPatch = { ...op.patch };
  if (op.patch.presentEntryIds) {
    patch.presentEntryIds = [
      ...new Set(op.patch.presentEntryIds.map((ref) => resolveRef(ctx, ref))),
    ];
  }
  const keys = Object.keys(patch) as (keyof StudioPlanItemPatch)[];
  const before = pickKeys(current, keys);
  const item = patchPlanItem(tx, {
    storyId: ctx.storyId,
    itemId: op.itemId,
    expectedRevision: current.revision,
    patch,
    markAuthorFields: false,
  });
  return { before, after: pickKeys(item, keys) };
}

function applyPlanMove(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"plan.move">,
): Result<"plan.move"> {
  const current = requirePlanItem(tx, ctx.storyId, op.itemId);
  const index = listSiblingRows(tx, ctx.storyId, current.parentId).findIndex(
    (row) => row.id === current.id,
  );
  const newParentId =
    op.newParentRef === null ? null : resolveRef(ctx, op.newParentRef);
  movePlanItem(tx, {
    storyId: ctx.storyId,
    itemId: op.itemId,
    newParentId,
    newIndex: op.newIndex,
  });
  return {
    before: { parentId: current.parentId, index: Math.max(0, index) },
    after: { parentId: newParentId },
  };
}

function applyPlanDelete(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"plan.delete">,
): Result<"plan.delete"> {
  const staged: { snapshot?: StudioDeletedSubtree } = {};
  removePlanSubtree(tx, ctx.storyId, op.itemId, (snapshot) => {
    staged.snapshot = snapshot;
  });
  if (!staged.snapshot) {
    throw new ActionError("INTERNAL_ERROR", "The delete was not recorded.");
  }
  return { snapshot: staged.snapshot };
}

/**
 * A new record is a planned, AI-written change. A label the entry already
 * tracks keeps its existing set/add mode (only the author's form changes a
 * label's mode).
 */
function applyChangeCreate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"change.create">,
): Result<"change.create"> {
  const entryId = resolveRef(ctx, op.entryRef);
  const aspect = cleanAspectLabel(op.aspect);
  const change = insertStudioChange(tx, {
    storyId: ctx.storyId,
    entryId,
    aspect,
    mode: ctx.modes.resolve(entryId, aspect, op.mode),
    aboutEntryId:
      op.aboutEntryRef === null ? null : resolveRef(ctx, op.aboutEntryRef),
    value: op.value,
    planItemId: resolveRef(ctx, op.planItemRef),
    provenance: "ai",
  });
  return {
    createdId: change.id,
    after: {
      aspect: change.aspect,
      mode: change.mode,
      value: change.value,
      aboutEntryId: change.aboutEntryId,
    },
  };
}

function applyChangeUpdate(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"change.update">,
): Result<"change.update"> {
  const current = requireChange(tx, ctx.storyId, op.changeId);
  const patch: StudioChangeFields = {};
  if (op.patch.aspect !== undefined) {
    patch.aspect = cleanAspectLabel(op.patch.aspect);
  }
  if (op.patch.value !== undefined) patch.value = op.patch.value;
  if (op.patch.aboutEntryId !== undefined) {
    patch.aboutEntryId =
      op.patch.aboutEntryId === null
        ? null
        : resolveRef(ctx, op.patch.aboutEntryId);
  }
  if (op.patch.planItemId !== undefined) {
    patch.planItemId = resolveRef(ctx, op.patch.planItemId);
  }
  if (op.patch.aspect !== undefined || op.patch.mode !== undefined) {
    const mode = ctx.modes.resolve(
      current.entryId,
      patch.aspect ?? current.aspect,
      op.patch.mode ?? current.mode,
    );
    if (mode !== current.mode || op.patch.mode !== undefined) patch.mode = mode;
  }
  const keys = Object.keys(patch) as (keyof StudioChangeFields)[];
  const before = pickKeys(current, keys);
  const change = patchStudioChange(tx, {
    storyId: ctx.storyId,
    changeId: op.changeId,
    patch,
    markAuthorEdited: false,
  });
  return { before, after: pickKeys(change, keys) };
}

function applyChangeDelete(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"change.delete">,
): Result<"change.delete"> {
  const row = requireChange(tx, ctx.storyId, op.changeId);
  removeStudioChange(tx, ctx.storyId, op.changeId);
  return { row };
}

/**
 * Accepted prose is AI prose ("ai-edited" when it replaces writing the
 * author touched). The replaced text and the new text are both versioned,
 * and the read-back hash is cleared, as when keeping a draft.
 */
function applyProseWrite(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOpOf<"prose.write">,
): Result<"prose.write"> {
  const momentId = resolveRef(ctx, op.momentRef);
  requirePlanItem(tx, ctx.storyId, momentId, "moment");
  const current = getProseRow(tx, momentId);
  if (current && current.markdown === op.markdown) {
    return { momentId, before: null, revisionAfter: null };
  }
  const replacesWriting =
    current !== undefined &&
    current.markdown.trim() !== "" &&
    current.origin !== "ai";
  const row = replaceMomentProse(tx, {
    storyId: ctx.storyId,
    momentId,
    markdown: op.markdown,
    expectedRevision: current?.revision ?? 0,
    origin: replacesWriting ? "ai-edited" : "ai",
    versionNewText: true,
    now: ctx.now,
  });
  return {
    momentId,
    before: current
      ? { markdown: current.markdown, origin: current.origin }
      : null,
    revisionAfter: row.revision,
  };
}

/** Sets related lists that named entries created later in the bundle. */
export function flushDeferredRelations(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
): void {
  for (const { entryId, refs } of ctx.deferredRelated.splice(0)) {
    tx.update(studioEntries)
      .set({
        relatedEntryIds: [...new Set(refs.map((ref) => resolveRef(ctx, ref)))],
      })
      .where(eq(studioEntries.id, entryId))
      .run();
  }
}

/**
 * Applies one accepted op and returns what its undo needs. Ops must come
 * in `orderBundleOpsForApply` order; the first op after the entry creates
 * settles their deferred related lists.
 */
export function applyBundleOp(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOp,
): StudioBundleOpResults[StudioBundleOpKind] {
  if (op.kind !== "entry.create") flushDeferredRelations(tx, ctx);
  switch (op.kind) {
    case "story.update":
      return applyStoryUpdate(tx, ctx, op);
    case "entry.create":
      return applyEntryCreate(tx, ctx, op);
    case "entry.update":
      return applyEntryUpdate(tx, ctx, op);
    case "entry.delete":
      return {
        snapshot: removeStudioEntryWithSnapshot(tx, ctx.storyId, op.entryId),
      };
    case "plan.create":
      return applyPlanCreate(tx, ctx, op);
    case "plan.update":
      return applyPlanUpdate(tx, ctx, op);
    case "plan.move":
      return applyPlanMove(tx, ctx, op);
    case "plan.delete":
      return applyPlanDelete(tx, ctx, op);
    case "change.create":
      return applyChangeCreate(tx, ctx, op);
    case "change.update":
      return applyChangeUpdate(tx, ctx, op);
    case "change.delete":
      return applyChangeDelete(tx, ctx, op);
    case "prose.write":
      return applyProseWrite(tx, ctx, op);
  }
}
