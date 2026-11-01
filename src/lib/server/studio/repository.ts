import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { getDb, type LocalinkTx } from "@/lib/drizzle/db";
import {
  studioBundles,
  studioChanges,
  studioEntries,
  studioFlags,
  studioPlanItems,
  studioProse,
  studioProseVersions,
  studioStories,
} from "@/lib/drizzle/schema";
import { legacyAspectMode } from "@/lib/studio/aspects";
import type {
  StudioBundleDto,
  StudioBundleOp,
  StudioBundleOpDto,
  StudioBundleStatus,
} from "@/lib/studio/bundle-contract";
import type {
  StudioChangeDto,
  StudioEntryDto,
  StudioFlagDto,
  StudioFlagPayload,
  StudioPlanItemDto,
  StudioPlanKind,
  StudioProseDto,
  StudioStoryDto,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import { normalizeEntryFields } from "@/lib/studio/entry-fields";

export type StudioStoryRow = typeof studioStories.$inferSelect;
export type StudioEntryRow = typeof studioEntries.$inferSelect;
export type StudioPlanItemRow = typeof studioPlanItems.$inferSelect;
export type StudioChangeRow = typeof studioChanges.$inferSelect;
export type StudioProseRow = typeof studioProse.$inferSelect;
export type StudioProseVersionRow = typeof studioProseVersions.$inferSelect;
export type StudioFlagRow = typeof studioFlags.$inferSelect;
export type StudioBundleRow = typeof studioBundles.$inferSelect;

/** Accepted bundles kept loaded so their undo stays reachable. */
const UNDOABLE_BUNDLES_LOADED = 10;

export type StudioDeletedSubtree = {
  storyId: string;
  rootId: string;
  rootParentId: string | null;
  rootPosition: number;
  /** Parents always precede their children. */
  items: StudioPlanItemRow[];
  prose: StudioProseRow[];
  versions: StudioProseVersionRow[];
  changes: StudioChangeRow[];
  flags: StudioFlagRow[];
};

const CHUNK_SIZE = 200;

export function chunk<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    result.push(items.slice(i, i + size));
  return result;
}

export function toStoryDto(row: StudioStoryRow): StudioStoryDto {
  return {
    id: row.id,
    title: row.title,
    overview: row.overview,
    instructions: row.instructions,
    style: row.style,
    theme: row.theme,
    structureTemplate: row.structureTemplate,
    structureNotes: row.structureNotes,
    brainDump: row.brainDump,
    voiceSamples: row.voiceSamples,
    proseModel: row.proseModel,
    chatModel: row.chatModel,
    setupStatus: row.setupStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEntryDto(row: StudioEntryRow): StudioEntryDto {
  return {
    id: row.id,
    storyId: row.storyId,
    type: row.type,
    customTypeLabel: row.customTypeLabel,
    name: row.name,
    summary: row.summary,
    fields: normalizeEntryFields(row.fields, row.type),
    relatedEntryIds: row.relatedEntryIds,
    position: row.position,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPlanItemDto(row: StudioPlanItemRow): StudioPlanItemDto {
  return {
    id: row.id,
    storyId: row.storyId,
    parentId: row.parentId,
    kind: row.kind,
    position: row.position,
    title: row.title,
    whatHappens: row.whatHappens,
    howToWrite: row.howToWrite,
    craft: row.craft,
    presentEntryIds: row.presentEntryIds,
    contextPinnedEntryIds: row.contextPinnedEntryIds,
    contextExcludedEntryIds: row.contextExcludedEntryIds,
    authorFields: row.authorFields,
    origin: row.origin,
    summary: row.summary,
    tension: row.tension,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toChangeDto(row: StudioChangeRow): StudioChangeDto {
  return {
    id: row.id,
    storyId: row.storyId,
    entryId: row.entryId,
    aboutEntryId: row.aboutEntryId,
    aspect: row.aspect,
    mode: row.mode,
    value: row.value,
    planItemId: row.planItemId,
    position: row.position,
    source: row.source,
    status: row.status,
    authorEdited: row.authorEdited,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toProseDto(row: StudioProseRow): StudioProseDto {
  return {
    momentId: row.momentId,
    storyId: row.storyId,
    markdown: row.markdown,
    origin: row.origin,
    revision: row.revision,
    wordCount: row.wordCount,
    readBackSourceHash: row.readBackSourceHash,
    readBackSentenceHashes: row.readBackSentenceHashes,
    updatedAt: row.updatedAt,
  };
}

/** Flags stored before modes existed get the mode their aspect implied. */
export function withFlagMode(payload: StudioFlagPayload): StudioFlagPayload {
  if (payload.kind !== "unplanned-change" || payload.mode) return payload;
  return { ...payload, mode: legacyAspectMode(payload.aspect) };
}

export function toFlagDto(row: StudioFlagRow): StudioFlagDto {
  return {
    id: row.id,
    storyId: row.storyId,
    planItemId: row.planItemId,
    kind: row.kind,
    payload: withFlagMode(row.payload),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Create ops record the real id they were given as `result.createdId`. */
function createdIdOf(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const createdId = (result as { createdId?: unknown }).createdId;
  return typeof createdId === "string" ? createdId : null;
}

/**
 * Undo data stays on the server; the client gets the created id only, and
 * none once the bundle is undone (those records are gone). The stored
 * results are kept as a record of what was applied.
 */
export function toBundleOpDto(
  op: StudioBundleOp,
  status: StudioBundleStatus,
): StudioBundleOpDto {
  const dto: StudioBundleOp & { createdId: string | null } = {
    ...op,
    createdId: status === "undone" ? null : createdIdOf(op.result),
  };
  delete dto.result;
  return dto;
}

export function toBundleDto(row: StudioBundleRow): StudioBundleDto {
  return {
    id: row.id,
    storyId: row.storyId,
    source: row.source,
    threadId: row.threadId,
    messageId: row.messageId,
    generationId: row.generationId,
    summary: row.summary,
    operations: row.operations.map((op) => toBundleOpDto(op, row.status)),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function loadStudioWorkspace(storyId: string): StudioWorkspace | null {
  const db = getDb();
  const story = db
    .select()
    .from(studioStories)
    .where(eq(studioStories.id, storyId))
    .get();
  if (!story) return null;

  const entries = db
    .select()
    .from(studioEntries)
    .where(eq(studioEntries.storyId, storyId))
    .orderBy(
      asc(studioEntries.type),
      asc(studioEntries.position),
      asc(studioEntries.createdAt),
      asc(studioEntries.id),
    )
    .all();
  const planItems = db
    .select()
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .orderBy(asc(studioPlanItems.position), asc(studioPlanItems.createdAt))
    .all();
  const changes = db
    .select()
    .from(studioChanges)
    .where(eq(studioChanges.storyId, storyId))
    .orderBy(asc(studioChanges.position), asc(studioChanges.createdAt))
    .all();
  const prose = db
    .select()
    .from(studioProse)
    .where(eq(studioProse.storyId, storyId))
    .all();
  const flags = db
    .select()
    .from(studioFlags)
    .where(eq(studioFlags.storyId, storyId))
    .orderBy(asc(studioFlags.createdAt))
    .all();
  const pendingBundles = db
    .select()
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.storyId, storyId),
        eq(studioBundles.status, "pending"),
      ),
    )
    .all();
  const undoableBundles = db
    .select()
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.storyId, storyId),
        inArray(studioBundles.status, ["accepted", "partially-accepted"]),
      ),
    )
    .orderBy(desc(studioBundles.updatedAt), desc(studioBundles.id))
    .limit(UNDOABLE_BUNDLES_LOADED)
    .all();
  const bundles = [...pendingBundles, ...undoableBundles].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  return {
    story: toStoryDto(story),
    entries: entries.map(toEntryDto),
    planItems: planItems.map(toPlanItemDto),
    changes: changes.map(toChangeDto),
    prose: prose.map(toProseDto),
    flags: flags.map(toFlagDto),
    bundles: bundles.map(toBundleDto),
  };
}

export function listStudioStories(): {
  id: string;
  title: string;
  overview: string;
  setupStatus: "draft" | "planned";
  updatedAt: string;
}[] {
  return getDb()
    .select({
      id: studioStories.id,
      title: studioStories.title,
      overview: studioStories.overview,
      setupStatus: studioStories.setupStatus,
      updatedAt: studioStories.updatedAt,
    })
    .from(studioStories)
    .orderBy(desc(studioStories.updatedAt), desc(studioStories.id))
    .all();
}

export function touchStudioStory(
  tx: LocalinkTx,
  storyId: string,
  now: string,
): void {
  tx.update(studioStories)
    .set({ updatedAt: now })
    .where(eq(studioStories.id, storyId))
    .run();
}

export function requireStudioStory(
  tx: LocalinkTx,
  storyId: string,
): StudioStoryRow {
  const story = tx
    .select()
    .from(studioStories)
    .where(eq(studioStories.id, storyId))
    .get();
  if (!story) {
    throw new ActionError("BAD_REQUEST", "The story could not be found.");
  }
  return story;
}

export function requirePlanItem(
  tx: LocalinkTx,
  storyId: string,
  itemId: string,
  kind?: StudioPlanKind,
): StudioPlanItemRow {
  const item = tx
    .select()
    .from(studioPlanItems)
    .where(
      and(eq(studioPlanItems.id, itemId), eq(studioPlanItems.storyId, storyId)),
    )
    .get();
  if (!item || (kind && item.kind !== kind)) {
    throw new ActionError(
      "BAD_REQUEST",
      kind
        ? `The ${kind} could not be found.`
        : "The plan item could not be found.",
    );
  }
  return item;
}

export function requireEntry(
  tx: LocalinkTx,
  storyId: string,
  entryId: string,
): StudioEntryRow {
  const entry = tx
    .select()
    .from(studioEntries)
    .where(
      and(eq(studioEntries.id, entryId), eq(studioEntries.storyId, storyId)),
    )
    .get();
  if (!entry) {
    throw new ActionError("BAD_REQUEST", "The entry could not be found.");
  }
  return entry;
}

/** Every id must name a Bible entry of this story. */
export function assertEntryIds(
  tx: LocalinkTx,
  storyId: string,
  ids: string[],
): void {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  let found = 0;
  for (const part of chunk(unique)) {
    found += tx
      .select({ id: studioEntries.id })
      .from(studioEntries)
      .where(
        and(
          eq(studioEntries.storyId, storyId),
          inArray(studioEntries.id, part),
        ),
      )
      .all().length;
  }
  if (found !== unique.length) {
    throw new ActionError("BAD_REQUEST", "An entry could not be found.");
  }
}

function parentFilter(storyId: string, parentId: string | null) {
  return and(
    eq(studioPlanItems.storyId, storyId),
    parentId === null
      ? isNull(studioPlanItems.parentId)
      : eq(studioPlanItems.parentId, parentId),
  );
}

/** Siblings in display order. */
export function listSiblingRows(
  tx: LocalinkTx,
  storyId: string,
  parentId: string | null,
): StudioPlanItemRow[] {
  return tx
    .select()
    .from(studioPlanItems)
    .where(parentFilter(storyId, parentId))
    .orderBy(
      asc(studioPlanItems.position),
      asc(studioPlanItems.createdAt),
      asc(studioPlanItems.id),
    )
    .all();
}

/**
 * Renumbers a sibling list to 0..n-1 in the given order. Returns the ids
 * whose stored position changed.
 */
export function applySiblingOrder(
  tx: LocalinkTx,
  storyId: string,
  parentId: string | null,
  orderedIds: string[],
  now: string,
): string[] {
  const current = new Map(
    listSiblingRows(tx, storyId, parentId).map((row) => [row.id, row]),
  );
  const changed: string[] = [];
  orderedIds.forEach((id, index) => {
    const row = current.get(id);
    if (!row || row.position === index) return;
    tx.update(studioPlanItems)
      .set({ position: index, updatedAt: now })
      .where(eq(studioPlanItems.id, id))
      .run();
    changed.push(id);
  });
  return changed;
}

/** Chapters sit at the root, scenes under chapters, moments under scenes. */
export function assertValidParent(
  tx: LocalinkTx,
  storyId: string,
  kind: StudioPlanKind,
  parentId: string | null,
): void {
  if (kind === "chapter") {
    if (parentId !== null) {
      throw new ActionError("BAD_REQUEST", "Chapters cannot have a parent.");
    }
    return;
  }
  const parentKind: StudioPlanKind = kind === "scene" ? "chapter" : "scene";
  if (parentId === null) {
    throw new ActionError(
      "BAD_REQUEST",
      `A ${kind} needs a ${parentKind} to live in.`,
    );
  }
  requirePlanItem(tx, storyId, parentId, parentKind);
}

export function selectPlanItemsByIds(
  tx: LocalinkTx,
  storyId: string,
  ids: string[],
): StudioPlanItemRow[] {
  const rows: StudioPlanItemRow[] = [];
  for (const part of chunk(ids)) {
    rows.push(
      ...tx
        .select()
        .from(studioPlanItems)
        .where(
          and(
            eq(studioPlanItems.storyId, storyId),
            inArray(studioPlanItems.id, part),
          ),
        )
        .all(),
    );
  }
  return rows;
}

export function snapshotPlanSubtree(
  tx: LocalinkTx,
  storyId: string,
  itemId: string,
): StudioDeletedSubtree {
  const root = requirePlanItem(tx, storyId, itemId);
  const all = tx
    .select()
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .all();
  const childrenByParent = new Map<string, StudioPlanItemRow[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }
  const items: StudioPlanItemRow[] = [];
  const queue: StudioPlanItemRow[] = [root];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    items.push(next);
    queue.push(...(childrenByParent.get(next.id) ?? []));
  }
  const ids = items.map((item) => item.id);

  const prose: StudioProseRow[] = [];
  const versions: StudioProseVersionRow[] = [];
  const changes: StudioChangeRow[] = [];
  const flags: StudioFlagRow[] = [];
  for (const part of chunk(ids)) {
    prose.push(
      ...tx
        .select()
        .from(studioProse)
        .where(inArray(studioProse.momentId, part))
        .all(),
    );
    versions.push(
      ...tx
        .select()
        .from(studioProseVersions)
        .where(inArray(studioProseVersions.momentId, part))
        .all(),
    );
    changes.push(
      ...tx
        .select()
        .from(studioChanges)
        .where(inArray(studioChanges.planItemId, part))
        .all(),
    );
    flags.push(
      ...tx
        .select()
        .from(studioFlags)
        .where(inArray(studioFlags.planItemId, part))
        .all(),
    );
  }

  return {
    storyId,
    rootId: root.id,
    rootParentId: root.parentId,
    rootPosition: root.position,
    items,
    prose,
    versions,
    changes,
    flags,
  };
}

export function restorePlanSubtree(
  tx: LocalinkTx,
  snapshot: StudioDeletedSubtree,
  now: string,
): void {
  const { storyId } = snapshot;
  requireStudioStory(tx, storyId);
  if (snapshot.rootParentId !== null) {
    const parent = tx
      .select({ id: studioPlanItems.id })
      .from(studioPlanItems)
      .where(
        and(
          eq(studioPlanItems.id, snapshot.rootParentId),
          eq(studioPlanItems.storyId, storyId),
        ),
      )
      .get();
    if (!parent) {
      throw new ActionError(
        "BAD_REQUEST",
        "The place this was removed from no longer exists, so it can't be restored.",
      );
    }
  }
  const existing = tx
    .select({ id: studioPlanItems.id })
    .from(studioPlanItems)
    .where(eq(studioPlanItems.id, snapshot.rootId))
    .get();
  if (existing) {
    throw new ActionError(
      "BAD_REQUEST",
      "This item has already been restored.",
    );
  }

  // Entries may have been deleted since the snapshot; drop what they anchored.
  const entryIds = new Set(
    tx
      .select({ id: studioEntries.id })
      .from(studioEntries)
      .where(eq(studioEntries.storyId, storyId))
      .all()
      .map((row) => row.id),
  );
  const keepExisting = (ids: string[]) => ids.filter((id) => entryIds.has(id));
  const items = snapshot.items.map((item) => ({
    ...item,
    presentEntryIds: keepExisting(item.presentEntryIds),
    contextPinnedEntryIds: keepExisting(item.contextPinnedEntryIds),
    contextExcludedEntryIds: keepExisting(item.contextExcludedEntryIds),
  }));
  for (const part of chunk(items, 50))
    tx.insert(studioPlanItems).values(part).run();
  for (const part of chunk(snapshot.prose, 20))
    tx.insert(studioProse).values(part).run();
  for (const part of chunk(snapshot.versions, 20))
    tx.insert(studioProseVersions).values(part).run();
  for (const part of chunk(snapshot.flags, 50))
    tx.insert(studioFlags).values(part).run();

  const changes = snapshot.changes
    .filter((change) => entryIds.has(change.entryId))
    .map((change) => ({
      ...change,
      aboutEntryId:
        change.aboutEntryId && entryIds.has(change.aboutEntryId)
          ? change.aboutEntryId
          : null,
    }));
  for (const part of chunk(changes, 50))
    tx.insert(studioChanges).values(part).run();

  // Put the root back where it was and shift later siblings along.
  const siblingIds = listSiblingRows(tx, storyId, snapshot.rootParentId)
    .filter((row) => row.id !== snapshot.rootId)
    .map((row) => row.id);
  siblingIds.splice(
    Math.min(snapshot.rootPosition, siblingIds.length),
    0,
    snapshot.rootId,
  );
  tx.update(studioPlanItems)
    .set({ position: -1 })
    .where(eq(studioPlanItems.id, snapshot.rootId))
    .run();
  applySiblingOrder(tx, storyId, snapshot.rootParentId, siblingIds, now);
  touchStudioStory(tx, storyId, now);
}
