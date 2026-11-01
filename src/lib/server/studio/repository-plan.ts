import "server-only";

import { isDeepStrictEqual } from "node:util";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioPlanItems } from "@/lib/drizzle/schema";
import type {
  StudioPlanField,
  StudioPlanItemDto,
  StudioPlanKind,
  StudioPlanOrigin,
} from "@/lib/studio/contracts";
import { generateId } from "@/lib/util";

import {
  applySiblingOrder,
  assertEntryIds,
  assertValidParent,
  listSiblingRows,
  requirePlanItem,
  requireStudioStory,
  type StudioDeletedSubtree,
  type StudioPlanItemRow,
  selectPlanItemsByIds,
  snapshotPlanSubtree,
  toPlanItemDto,
  touchStudioStory,
} from "./repository";

/**
 * Inserts a plan item after `afterItemId` (or last) and renumbers its
 * siblings. Returns the new row plus every sibling whose position shifted.
 * An author-made item owns its title; an AI item (an accepted bundle's new
 * item) owns nothing, so later AI passes may refine it.
 */
export function insertPlanItem(
  tx: LocalinkTx,
  input: {
    storyId: string;
    kind: StudioPlanKind;
    parentId: string | null;
    afterItemId?: string | null;
    title?: string;
    now: string;
    origin?: StudioPlanOrigin;
    content?: {
      whatHappens: string;
      howToWrite: string;
      craft: Record<string, string>;
      presentEntryIds: string[];
    };
  },
): { item: StudioPlanItemRow; shiftedIds: string[] } {
  const { storyId, kind, parentId, now } = input;
  requireStudioStory(tx, storyId);
  assertValidParent(tx, storyId, kind, parentId);
  const siblingIds = listSiblingRows(tx, storyId, parentId).map(
    (row) => row.id,
  );
  let index = siblingIds.length;
  if (input.afterItemId) {
    const afterIndex = siblingIds.indexOf(input.afterItemId);
    if (afterIndex === -1) {
      throw new ActionError(
        "BAD_REQUEST",
        "The item to insert after is not in this list.",
      );
    }
    index = afterIndex + 1;
  }
  const title = input.title?.trim() ?? "";
  const origin = input.origin ?? "author";
  const id = generateId("studio-plan");
  tx.insert(studioPlanItems)
    .values({
      id,
      storyId,
      parentId,
      kind,
      position: siblingIds.length,
      title,
      ...input.content,
      origin,
      authorFields: origin === "author" && title ? ["title"] : [],
      createdAt: now,
      updatedAt: now,
    })
    .run();
  siblingIds.splice(index, 0, id);
  const shiftedIds = applySiblingOrder(tx, storyId, parentId, siblingIds, now);
  const item = requirePlanItem(tx, storyId, id);
  return { item, shiftedIds: shiftedIds.filter((shifted) => shifted !== id) };
}

export function createPlanItem(
  tx: LocalinkTx,
  input: {
    storyId: string;
    kind: StudioPlanKind;
    parentId: string | null;
    afterItemId?: string | null;
    title?: string;
  },
): { item: StudioPlanItemDto; shifted: StudioPlanItemDto[] } {
  const now = day().toISOString();
  const { item, shiftedIds } = insertPlanItem(tx, { ...input, now });
  touchStudioStory(tx, input.storyId, now);
  return {
    item: toPlanItemDto(item),
    shifted: selectPlanItemsByIds(tx, input.storyId, shiftedIds).map(
      toPlanItemDto,
    ),
  };
}

export type StudioPlanItemPatch = Partial<{
  title: string;
  whatHappens: string;
  howToWrite: string;
  craft: Record<string, string>;
  presentEntryIds: string[];
  contextPinnedEntryIds: string[];
  contextExcludedEntryIds: string[];
  tension: number | null;
}>;

const AUTHOR_FIELD_KEYS: StudioPlanField[] = [
  "title",
  "whatHappens",
  "howToWrite",
  "craft",
  "presentEntryIds",
];

export function patchPlanItem(
  tx: LocalinkTx,
  input: {
    storyId: string;
    itemId: string;
    expectedRevision: number;
    patch: StudioPlanItemPatch;
    /**
     * False for an accepted bundle: the edit is approved, not written by the
     * author, so each field keeps the ownership it had.
     */
    markAuthorFields?: boolean;
  },
): StudioPlanItemDto {
  const { storyId, itemId, patch } = input;
  const current = requirePlanItem(tx, storyId, itemId);
  if (
    patch.tension !== undefined &&
    patch.tension !== null &&
    current.kind !== "chapter"
  ) {
    throw new ActionError("BAD_REQUEST", "Only chapters have a tension level.");
  }
  assertEntryIds(tx, storyId, [
    ...(patch.presentEntryIds ?? []),
    ...(patch.contextPinnedEntryIds ?? []),
    ...(patch.contextExcludedEntryIds ?? []),
  ]);

  const keys = Object.keys(patch) as (keyof StudioPlanItemPatch)[];
  // A response may be lost after commit. A retry of that exact patch is safe.
  if (keys.every((key) => isDeepStrictEqual(patch[key], current[key]))) {
    return toPlanItemDto(current);
  }
  if (current.revision !== input.expectedRevision) {
    throw new ActionError(
      "CONFLICT",
      "This plan item changed elsewhere. Your edits are still on screen; reload the saved plan before trying again.",
    );
  }
  const authorFields =
    input.markAuthorFields === false
      ? current.authorFields
      : [
          ...new Set([
            ...current.authorFields,
            ...AUTHOR_FIELD_KEYS.filter((key) => key in patch),
          ]),
        ];
  const now = day().toISOString();
  const row = tx
    .update(studioPlanItems)
    .set({
      ...patch,
      authorFields,
      revision: current.revision + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(studioPlanItems.id, itemId),
        eq(studioPlanItems.storyId, storyId),
        eq(studioPlanItems.revision, input.expectedRevision),
      ),
    )
    .returning()
    .get();
  if (!row) {
    throw new ActionError(
      "CONFLICT",
      "This plan item changed elsewhere. Your edits are still on screen.",
    );
  }
  touchStudioStory(tx, storyId, now);
  return toPlanItemDto(row);
}

/** Returns every item whose `position` or `parentId` changed. */
export function movePlanItem(
  tx: LocalinkTx,
  input: {
    storyId: string;
    itemId: string;
    newParentId: string | null;
    newIndex: number;
  },
): StudioPlanItemDto[] {
  const { storyId, itemId, newParentId } = input;
  const now = day().toISOString();
  const item = requirePlanItem(tx, storyId, itemId);
  assertValidParent(tx, storyId, item.kind, newParentId);

  const changed = new Set<string>();
  const oldParentId = item.parentId;
  if (oldParentId !== newParentId) {
    tx.update(studioPlanItems)
      .set({ parentId: newParentId, updatedAt: now })
      .where(eq(studioPlanItems.id, itemId))
      .run();
    changed.add(itemId);
  }
  const targetIds = listSiblingRows(tx, storyId, newParentId)
    .map((row) => row.id)
    .filter((id) => id !== itemId);
  targetIds.splice(Math.min(input.newIndex, targetIds.length), 0, itemId);
  for (const id of applySiblingOrder(tx, storyId, newParentId, targetIds, now))
    changed.add(id);

  if (oldParentId !== newParentId) {
    const oldIds = listSiblingRows(tx, storyId, oldParentId).map(
      (row) => row.id,
    );
    for (const id of applySiblingOrder(tx, storyId, oldParentId, oldIds, now))
      changed.add(id);
  }
  if (changed.size > 0) touchStudioStory(tx, storyId, now);
  return selectPlanItemsByIds(tx, storyId, [...changed]).map(toPlanItemDto);
}

/**
 * Snapshots the subtree for undo, hands the snapshot to `stage`, deletes it
 * and closes the gap in the old sibling list.
 */
export function removePlanSubtree(
  tx: LocalinkTx,
  storyId: string,
  itemId: string,
  stage: (snapshot: StudioDeletedSubtree) => void,
): { deletedIds: string[] } {
  const now = day().toISOString();
  const snapshot = snapshotPlanSubtree(tx, storyId, itemId);
  stage(snapshot);
  // Foreign keys cascade descendants, prose, versions, changes and flags.
  tx.delete(studioPlanItems).where(eq(studioPlanItems.id, itemId)).run();
  const remaining = listSiblingRows(tx, storyId, snapshot.rootParentId).map(
    (row) => row.id,
  );
  applySiblingOrder(tx, storyId, snapshot.rootParentId, remaining, now);
  touchStudioStory(tx, storyId, now);
  return { deletedIds: snapshot.items.map((row) => row.id) };
}
