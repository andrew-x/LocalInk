import "server-only";

import { isDeepStrictEqual } from "node:util";

import { and, eq, max, or } from "drizzle-orm";

import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioPlanItems,
} from "@/lib/drizzle/schema";
import type {
  StudioBundleOp,
  StudioBundleOpOf,
  StudioBundleStoryPatch,
} from "@/lib/studio/bundle-contract";
import { normalizeEntryFields } from "@/lib/studio/entry-fields";

import {
  readOpResult,
  type StudioChangeFields,
  type StudioEntryContent,
} from "./bundle-kit";
import {
  requireStudioStory,
  restorePlanSubtree,
  type StudioEntryRow,
  type StudioPlanItemRow,
} from "./repository";
import {
  patchStudioChange,
  patchStudioEntry,
  patchStudioStory,
  removeStudioChange,
  removeStudioEntry,
  restoreStudioEntry,
} from "./repository-bible";
import {
  movePlanItem,
  patchPlanItem,
  removePlanSubtree,
  type StudioPlanItemPatch,
} from "./repository-plan";
import { getProseRow, replaceMomentProse } from "./repository-prose";

type UndoContext = { storyId: string; now: string };

function findEntry(
  tx: LocalinkTx,
  storyId: string,
  entryId: string,
): StudioEntryRow | undefined {
  return tx
    .select()
    .from(studioEntries)
    .where(
      and(eq(studioEntries.id, entryId), eq(studioEntries.storyId, storyId)),
    )
    .get();
}

function findPlanItem(
  tx: LocalinkTx,
  storyId: string,
  itemId: string,
): StudioPlanItemRow | undefined {
  return tx
    .select()
    .from(studioPlanItems)
    .where(
      and(eq(studioPlanItems.id, itemId), eq(studioPlanItems.storyId, storyId)),
    )
    .get();
}

function findChange(tx: LocalinkTx, storyId: string, changeId: string) {
  return tx
    .select()
    .from(studioChanges)
    .where(
      and(eq(studioChanges.id, changeId), eq(studioChanges.storyId, storyId)),
    )
    .get();
}

/** True when every value the op wrote is still there. */
function stillMatches<T extends object>(
  current: T,
  after: Partial<Record<keyof T, unknown>>,
): boolean {
  return (Object.keys(after) as (keyof T)[]).every((key) =>
    isDeepStrictEqual(current[key], after[key]),
  );
}

function entryContent(row: StudioEntryRow): StudioEntryContent {
  return {
    name: row.name,
    summary: row.summary,
    fields: normalizeEntryFields(row.fields, row.type),
  };
}

function undoStoryUpdate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"story.update">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const story = requireStudioStory(tx, ctx.storyId);
  if (!stillMatches<StudioBundleStoryPatch>(story, result.after)) return false;
  patchStudioStory(tx, ctx.storyId, result.before);
  return true;
}

/**
 * Removes a created entry the author has not edited. Records that point at
 * it and were not created by this bundle (already undone by now) would be
 * lost or unlinked, so they block undo.
 */
function undoEntryCreate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"entry.create">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const entry = findEntry(tx, ctx.storyId, result.createdId);
  if (!entry || !isDeepStrictEqual(entryContent(entry), result.after)) {
    return false;
  }
  const linked = tx
    .select({ id: studioChanges.id })
    .from(studioChanges)
    .where(
      and(
        eq(studioChanges.storyId, ctx.storyId),
        or(
          eq(studioChanges.entryId, entry.id),
          eq(studioChanges.aboutEntryId, entry.id),
        ),
      ),
    )
    .get();
  if (linked) return false;
  removeStudioEntry(tx, ctx.storyId, entry.id);
  return true;
}

function undoEntryUpdate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"entry.update">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const entry = findEntry(tx, ctx.storyId, result.entryId);
  if (!entry || !stillMatches(entryContent(entry), result.after)) return false;
  patchStudioEntry(tx, {
    storyId: ctx.storyId,
    entryId: entry.id,
    expectedRevision: entry.revision,
    patch: result.before,
    stampAuthors: false,
  });
  return true;
}

function undoEntryDelete(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"entry.delete">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  if (findEntry(tx, ctx.storyId, result.snapshot.entry.id)) return false;
  restoreStudioEntry(tx, result.snapshot, ctx.now);
  return true;
}

/**
 * Removes a created plan item while it is still AI scaffolding: no field the
 * author edited, no children, no prose left (this bundle's own prose is
 * undone by now). Read-back moves a scene's planned changes down into the
 * moment that writes them; those go back up to the parent as planned.
 * Records the author wrote there block undo.
 */
function undoPlanCreate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"plan.create">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const item = findPlanItem(tx, ctx.storyId, result.createdId);
  if (
    !item ||
    item.authorFields.length > 0 ||
    !stillMatches(item, result.after)
  ) {
    return false;
  }
  const child = tx
    .select({ id: studioPlanItems.id })
    .from(studioPlanItems)
    .where(eq(studioPlanItems.parentId, item.id))
    .get();
  if (child || getProseRow(tx, item.id)?.markdown.trim()) return false;
  const pinned = tx
    .select()
    .from(studioChanges)
    .where(eq(studioChanges.planItemId, item.id))
    .all()
    .sort((a, b) => a.position - b.position);
  if (pinned.length > 0) {
    const parentId = item.parentId;
    if (parentId === null || pinned.some((change) => change.authorEdited)) {
      return false;
    }
    const last = tx
      .select({ value: max(studioChanges.position) })
      .from(studioChanges)
      .where(eq(studioChanges.planItemId, parentId))
      .get();
    let position = (last?.value ?? -1) + 1;
    for (const change of pinned) {
      tx.update(studioChanges)
        .set({
          planItemId: parentId,
          position: position++,
          status: "planned",
          updatedAt: ctx.now,
        })
        .where(eq(studioChanges.id, change.id))
        .run();
    }
  }
  removePlanSubtree(tx, ctx.storyId, item.id, () => undefined);
  return true;
}

function undoPlanUpdate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"plan.update">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const item = findPlanItem(tx, ctx.storyId, op.itemId);
  if (!item || !stillMatches(item, result.after)) return false;
  const patch: StudioPlanItemPatch = { ...result.before };
  if (patch.presentEntryIds) {
    patch.presentEntryIds = patch.presentEntryIds.filter((id) =>
      findEntry(tx, ctx.storyId, id),
    );
  }
  patchPlanItem(tx, {
    storyId: ctx.storyId,
    itemId: item.id,
    expectedRevision: item.revision,
    patch,
    markAuthorFields: false,
  });
  return true;
}

function undoPlanMove(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"plan.move">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const item = findPlanItem(tx, ctx.storyId, op.itemId);
  if (!item || item.parentId !== result.after.parentId) return false;
  const { parentId, index } = result.before;
  if (parentId !== null && !findPlanItem(tx, ctx.storyId, parentId)) {
    return false;
  }
  movePlanItem(tx, {
    storyId: ctx.storyId,
    itemId: item.id,
    newParentId: parentId,
    newIndex: index,
  });
  return true;
}

function undoPlanDelete(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"plan.delete">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const { snapshot } = result;
  if (findPlanItem(tx, ctx.storyId, snapshot.rootId)) return false;
  if (
    snapshot.rootParentId !== null &&
    !findPlanItem(tx, ctx.storyId, snapshot.rootParentId)
  ) {
    return false;
  }
  restorePlanSubtree(tx, snapshot, ctx.now);
  return true;
}

/** Read-back may confirm or move it down; only edits to it block undo. */
function undoChangeCreate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"change.create">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const change = findChange(tx, ctx.storyId, result.createdId);
  if (!change || change.authorEdited || !stillMatches(change, result.after)) {
    return false;
  }
  removeStudioChange(tx, ctx.storyId, change.id);
  return true;
}

function undoChangeUpdate(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"change.update">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const change = findChange(tx, ctx.storyId, op.changeId);
  if (!change || !stillMatches(change, result.after)) return false;
  const before: StudioChangeFields = result.before;
  if (before.planItemId && !findPlanItem(tx, ctx.storyId, before.planItemId)) {
    return false;
  }
  if (before.aboutEntryId && !findEntry(tx, ctx.storyId, before.aboutEntryId)) {
    return false;
  }
  patchStudioChange(tx, {
    storyId: ctx.storyId,
    changeId: change.id,
    patch: before,
    markAuthorEdited: false,
  });
  return true;
}

function undoChangeDelete(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"change.delete">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  const { row } = result;
  if (
    findChange(tx, ctx.storyId, row.id) ||
    !findEntry(tx, ctx.storyId, row.entryId) ||
    !findPlanItem(tx, ctx.storyId, row.planItemId)
  ) {
    return false;
  }
  const aboutEntryId =
    row.aboutEntryId && findEntry(tx, ctx.storyId, row.aboutEntryId)
      ? row.aboutEntryId
      : null;
  tx.insert(studioChanges)
    .values({ ...row, aboutEntryId, updatedAt: ctx.now })
    .run();
  return true;
}

/** Puts the replaced text back while the moment is exactly as accepted. */
function undoProseWrite(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOpOf<"prose.write">,
): boolean {
  const result = readOpResult(op);
  if (!result) return false;
  if (result.revisionAfter === null) return true;
  const prose = getProseRow(tx, result.momentId);
  if (!prose || prose.revision !== result.revisionAfter) return false;
  replaceMomentProse(tx, {
    storyId: ctx.storyId,
    momentId: result.momentId,
    markdown: result.before?.markdown ?? "",
    expectedRevision: prose.revision,
    origin: result.before?.origin ?? "author",
    versionNewText: false,
    now: ctx.now,
  });
  return true;
}

/**
 * Reverses one accepted op if what it wrote is still in place. Returns
 * false (writing nothing) when it is not; the caller fails the whole undo.
 */
export function undoBundleOp(
  tx: LocalinkTx,
  ctx: UndoContext,
  op: StudioBundleOp,
): boolean {
  switch (op.kind) {
    case "story.update":
      return undoStoryUpdate(tx, ctx, op);
    case "entry.create":
      return undoEntryCreate(tx, ctx, op);
    case "entry.update":
      return undoEntryUpdate(tx, ctx, op);
    case "entry.delete":
      return undoEntryDelete(tx, ctx, op);
    case "plan.create":
      return undoPlanCreate(tx, ctx, op);
    case "plan.update":
      return undoPlanUpdate(tx, ctx, op);
    case "plan.move":
      return undoPlanMove(tx, ctx, op);
    case "plan.delete":
      return undoPlanDelete(tx, ctx, op);
    case "change.create":
      return undoChangeCreate(tx, ctx, op);
    case "change.update":
      return undoChangeUpdate(tx, ctx, op);
    case "change.delete":
      return undoChangeDelete(tx, ctx, op);
    case "prose.write":
      return undoProseWrite(tx, ctx, op);
  }
}
