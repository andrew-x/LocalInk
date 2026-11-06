import "server-only";

import { isDeepStrictEqual } from "node:util";

import { and, eq, inArray, isNull, max } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioFlags,
  studioPlanItems,
  studioStories,
} from "@/lib/drizzle/schema";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioAspect,
  type StudioChangeDto,
  type StudioChangeMode,
  type StudioEntryDto,
  type StudioEntryField,
  type StudioEntryType,
  type StudioFlagDto,
  type StudioStoryDto,
  type StudioStructureTemplateId,
  type StudioSummaryOrigin,
  type StudioVoice,
} from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  normalizeEntryFields,
  refreshAiFields,
  type StudioFieldRefreshOp,
} from "@/lib/studio/entry-fields";
import { markStaleSamples } from "@/lib/studio/voice";
import { generateId } from "@/lib/util";

import {
  assertEntryIds,
  chunk,
  requireEntry,
  requirePlanItem,
  requireStudioStory,
  type StudioChangeRow,
  type StudioEntryRow,
  toChangeDto,
  toEntryDto,
  toFlagDto,
  toStoryDto,
  touchStudioStory,
} from "./repository";

export function insertStudioStory(
  tx: LocalinkTx,
  input: {
    title: string;
    brainDump: string;
    instructions?: string;
  },
): StudioStoryDto {
  const now = day().toISOString();
  // The migration also bakes defaults for these, but app code stays explicit.
  const row = tx
    .insert(studioStories)
    .values({
      id: generateId("studio-story"),
      title: input.title,
      brainDump: input.brainDump,
      instructions: input.instructions ?? "",
      voiceSamples: [],
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toStoryDto(row);
}

export type StudioStoryPatch = Partial<{
  title: string;
  overview: string;
  instructions: string;
  theme: string;
  structureTemplate: StudioStructureTemplateId;
  structureNotes: string;
  genre: string[];
  voice: StudioVoice;
}>;

/** Settings fields have a single writer, so the last write wins. */
export function patchStudioStory(
  tx: LocalinkTx,
  storyId: string,
  patch: StudioStoryPatch,
): StudioStoryDto {
  const current = requireStudioStory(tx, storyId);
  const changesVoice = patch.genre !== undefined || patch.voice !== undefined;
  const voiceSamples = changesVoice
    ? markStaleSamples(
        { genre: current.genre, voice: current.voice },
        {
          genre: patch.genre ?? current.genre,
          voice: patch.voice ?? current.voice,
          samples: current.voiceSamples,
        },
      )
    : undefined;
  const row = tx
    .update(studioStories)
    .set({
      ...patch,
      ...(voiceSamples ? { voiceSamples } : {}),
      updatedAt: day().toISOString(),
    })
    .where(eq(studioStories.id, storyId))
    .returning()
    .get();
  return toStoryDto(row);
}

export type NewStudioEntryField = Pick<
  StudioEntryField,
  "label" | "value" | "steerOnly" | "backstoryOnly"
>;

export function insertStudioEntry(
  tx: LocalinkTx,
  input: {
    storyId: string;
    type: StudioEntryType;
    name: string;
    summary?: string;
    customTypeLabel?: string;
    relatedEntryIds?: string[];
    fields?: NewStudioEntryField[];
    /** "ai" for an accepted bundle's new entry: new fields are AI-written. */
    fieldAuthor?: "ai" | "author";
    /** "ai" for a cast-step draft, which the AI may still rewrite. */
    summaryOrigin?: StudioSummaryOrigin;
  },
): StudioEntryDto {
  const now = day().toISOString();
  requireStudioStory(tx, input.storyId);
  assertEntryIds(tx, input.storyId, input.relatedEntryIds ?? []);
  const last = tx
    .select({ value: max(studioEntries.position) })
    .from(studioEntries)
    .where(
      and(
        eq(studioEntries.storyId, input.storyId),
        eq(studioEntries.type, input.type),
      ),
    )
    .get();
  const row = tx
    .insert(studioEntries)
    .values({
      id: generateId("studio-entry"),
      storyId: input.storyId,
      type: input.type,
      name: input.name,
      summary: input.summary ?? "",
      summaryOrigin: input.summaryOrigin ?? "author",
      customTypeLabel:
        input.type === "custom" ? (input.customTypeLabel ?? "") : "",
      fields: (input.fields ?? []).map(
        (field): StudioEntryField => ({
          id: generateId("studio-field"),
          label: field.label,
          value: field.value,
          author: input.fieldAuthor ?? "author",
          steerOnly: field.steerOnly,
          backstoryOnly: field.backstoryOnly,
        }),
      ),
      relatedEntryIds: [...new Set(input.relatedEntryIds ?? [])],
      position: (last?.value ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  touchStudioStory(tx, input.storyId, now);
  return toEntryDto(row);
}

export type StudioEntryPatch = Partial<{
  name: string;
  summary: string;
  fields: StudioEntryField[];
  relatedEntryIds: string[];
  customTypeLabel: string;
}>;

function stampAuthorFields(
  stored: StudioEntryField[],
  desired: StudioEntryField[],
): StudioEntryField[] {
  const storedById = new Map(stored.map((field) => [field.id, field]));
  const usedIds = new Set<string>();
  return desired.map((field) => {
    const label = cleanFieldLabel(field.label);
    const previous = storedById.get(field.id);
    const id = usedIds.has(field.id) ? generateId("studio-field") : field.id;
    usedIds.add(id);
    const unchanged =
      previous !== undefined &&
      id === previous.id &&
      previous.label === label &&
      previous.value === field.value &&
      previous.steerOnly === field.steerOnly &&
      previous.backstoryOnly === field.backstoryOnly;
    return {
      id,
      label,
      value: field.value,
      author: unchanged ? previous.author : "author",
      steerOnly: field.steerOnly,
      backstoryOnly: field.backstoryOnly,
    };
  });
}

export function patchStudioEntry(
  tx: LocalinkTx,
  input: {
    storyId: string;
    entryId: string;
    expectedRevision: number;
    patch: StudioEntryPatch;
    /**
     * False when the caller already set each field's author (an accepted
     * bundle keeps ownership as it was); the list is stored as given.
     */
    stampAuthors?: boolean;
  },
): StudioEntryDto {
  const { storyId, entryId, patch } = input;
  const current = requireEntry(tx, storyId, entryId);
  if (patch.relatedEntryIds) assertEntryIds(tx, storyId, patch.relatedEntryIds);

  // The client sends the full desired list. A field that is new or differs
  // from the stored field with the same id is author-written from here on.
  const currentFields = normalizeEntryFields(current.fields, current.type);
  const fields = !patch.fields
    ? currentFields
    : input.stampAuthors === false
      ? patch.fields
      : stampAuthorFields(currentFields, patch.fields);
  // An author edit may not grow the list past the cap. It is checked against
  // the stored count rather than as a flat bound, so an entry already over
  // it can still be edited and trimmed. (Bundle accept pre-checks the cap
  // itself, and undo restores an exact earlier list.)
  if (
    input.stampAuthors !== false &&
    fields.length > STUDIO_MAX_ENTRY_FIELDS &&
    fields.length > currentFields.length
  ) {
    throw new ActionError(
      "BAD_REQUEST",
      `An entry can hold at most ${STUDIO_MAX_ENTRY_FIELDS} fields. Remove one before adding another.`,
    );
  }
  const summary = patch.summary ?? current.summary;
  const next = {
    name: patch.name ?? current.name,
    summary,
    // An author edit to an AI-drafted paragraph makes it the author's.
    summaryOrigin:
      input.stampAuthors !== false && summary !== current.summary
        ? ("author" as const)
        : current.summaryOrigin,
    fields,
    relatedEntryIds: patch.relatedEntryIds
      ? [...new Set(patch.relatedEntryIds)]
      : current.relatedEntryIds,
    customTypeLabel:
      current.type === "custom"
        ? (patch.customTypeLabel ?? current.customTypeLabel)
        : "",
  };
  // A response may be lost after commit. A retry of that exact patch is safe.
  if (
    next.name === current.name &&
    next.summary === current.summary &&
    next.customTypeLabel === current.customTypeLabel &&
    isDeepStrictEqual(next.fields, currentFields) &&
    isDeepStrictEqual(next.relatedEntryIds, current.relatedEntryIds)
  ) {
    return toEntryDto(current);
  }
  if (current.revision !== input.expectedRevision) {
    throw new ActionError(
      "CONFLICT",
      "This entry changed elsewhere. Your edits are still on screen; reload the saved entry before trying again.",
    );
  }
  const now = day().toISOString();
  const row = tx
    .update(studioEntries)
    .set({ ...next, revision: current.revision + 1, updatedAt: now })
    .where(
      and(
        eq(studioEntries.id, entryId),
        eq(studioEntries.storyId, storyId),
        eq(studioEntries.revision, input.expectedRevision),
      ),
    )
    .returning()
    .get();
  if (!row) {
    throw new ActionError(
      "CONFLICT",
      "This entry changed elsewhere. Your edits are still on screen.",
    );
  }
  touchStudioStory(tx, storyId, now);
  return toEntryDto(row);
}

/**
 * Deletes an entry and strips it from every list that referenced it. Open
 * flags about the entry, or about a change record that goes with it, can no
 * longer be acted on, so they are dismissed; those flags are returned.
 */
export function removeStudioEntry(
  tx: LocalinkTx,
  storyId: string,
  entryId: string,
): { flags: StudioFlagDto[] } {
  requireEntry(tx, storyId, entryId);
  const cascadedChangeIds = new Set(
    tx
      .select({ id: studioChanges.id })
      .from(studioChanges)
      .where(
        and(
          eq(studioChanges.storyId, storyId),
          eq(studioChanges.entryId, entryId),
        ),
      )
      .all()
      .map((row) => row.id),
  );
  // Foreign keys cascade the entry's change records.
  tx.delete(studioEntries)
    .where(
      and(eq(studioEntries.id, entryId), eq(studioEntries.storyId, storyId)),
    )
    .run();
  const now = day().toISOString();
  const without = (ids: string[]) => ids.filter((id) => id !== entryId);

  const flags: StudioFlagDto[] = [];
  for (const flag of tx
    .select()
    .from(studioFlags)
    .where(
      and(eq(studioFlags.storyId, storyId), eq(studioFlags.status, "open")),
    )
    .all()) {
    const { payload } = flag;
    const moot =
      payload.kind === "unplanned-change"
        ? payload.entryId === entryId || payload.aboutEntryId === entryId
        : cascadedChangeIds.has(payload.changeId);
    if (!moot) continue;
    flags.push(
      toFlagDto(
        tx
          .update(studioFlags)
          .set({ status: "dismissed", updatedAt: now })
          .where(eq(studioFlags.id, flag.id))
          .returning()
          .get(),
      ),
    );
  }

  // Strip the id from every list that referenced it.
  for (const row of tx
    .select()
    .from(studioEntries)
    .where(eq(studioEntries.storyId, storyId))
    .all()) {
    if (!row.relatedEntryIds.includes(entryId)) continue;
    tx.update(studioEntries)
      .set({
        relatedEntryIds: without(row.relatedEntryIds),
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(eq(studioEntries.id, row.id))
      .run();
  }
  for (const row of tx
    .select()
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .all()) {
    if (
      !row.presentEntryIds.includes(entryId) &&
      !row.contextPinnedEntryIds.includes(entryId) &&
      !row.contextExcludedEntryIds.includes(entryId)
    )
      continue;
    tx.update(studioPlanItems)
      .set({
        presentEntryIds: without(row.presentEntryIds),
        contextPinnedEntryIds: without(row.contextPinnedEntryIds),
        contextExcludedEntryIds: without(row.contextExcludedEntryIds),
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(eq(studioPlanItems.id, row.id))
      .run();
  }
  touchStudioStory(tx, storyId, now);
  return { flags };
}

/** What restoring a deleted entry needs: the row, its records, its places. */
export type StudioDeletedEntry = {
  storyId: string;
  entry: StudioEntryRow;
  /** Records about the entry itself; foreign keys delete them with it. */
  changes: StudioChangeRow[];
  /** Records whose about-entry it was; the delete cleared that link. */
  aboutChangeIds: string[];
  /** Where its id sat in other entries' related lists. */
  relatedIn: { entryId: string; index: number }[];
  /** Where its id sat in plan items' entry lists (-1 when absent). */
  listedIn: {
    itemId: string;
    present: number;
    pinned: number;
    excluded: number;
  }[];
  /** Open flags the delete dismissed. */
  dismissedFlagIds: string[];
};

/**
 * `removeStudioEntry` plus a snapshot that `restoreStudioEntry` can put
 * back. Accepted bundles store it so their undo survives a restart.
 */
export function removeStudioEntryWithSnapshot(
  tx: LocalinkTx,
  storyId: string,
  entryId: string,
): StudioDeletedEntry {
  const entry = requireEntry(tx, storyId, entryId);
  const storyChanges = tx
    .select()
    .from(studioChanges)
    .where(eq(studioChanges.storyId, storyId))
    .all();
  const relatedIn = tx
    .select({ id: studioEntries.id, ids: studioEntries.relatedEntryIds })
    .from(studioEntries)
    .where(eq(studioEntries.storyId, storyId))
    .all()
    .filter((row) => row.ids.includes(entryId))
    .map((row) => ({ entryId: row.id, index: row.ids.indexOf(entryId) }));
  const listedIn = tx
    .select()
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .all()
    .map((row) => ({
      itemId: row.id,
      present: row.presentEntryIds.indexOf(entryId),
      pinned: row.contextPinnedEntryIds.indexOf(entryId),
      excluded: row.contextExcludedEntryIds.indexOf(entryId),
    }))
    .filter((row) => row.present >= 0 || row.pinned >= 0 || row.excluded >= 0);
  const { flags } = removeStudioEntry(tx, storyId, entryId);
  return {
    storyId,
    entry,
    changes: storyChanges.filter((row) => row.entryId === entryId),
    aboutChangeIds: storyChanges
      .filter((row) => row.aboutEntryId === entryId)
      .map((row) => row.id),
    relatedIn,
    listedIn,
    dismissedFlagIds: flags.map((flag) => flag.id),
  };
}

function insertAt(ids: string[], id: string, index: number): string[] {
  if (index < 0 || ids.includes(id)) return ids;
  const next = [...ids];
  next.splice(Math.min(index, next.length), 0, id);
  return next;
}

/**
 * Puts a deleted entry back: the row, its records (those whose plan item
 * still exists), its about-links, its places in related and plan lists, and
 * the flags its delete dismissed. Anything since removed stays removed.
 */
export function restoreStudioEntry(
  tx: LocalinkTx,
  snapshot: StudioDeletedEntry,
  now: string,
): void {
  const { storyId, entry } = snapshot;
  requireStudioStory(tx, storyId);
  const existing = tx
    .select({ id: studioEntries.id })
    .from(studioEntries)
    .where(eq(studioEntries.id, entry.id))
    .get();
  if (existing) {
    throw new ActionError(
      "BAD_REQUEST",
      "This entry has already been restored.",
    );
  }
  const entryIds = new Set(
    tx
      .select({ id: studioEntries.id })
      .from(studioEntries)
      .where(eq(studioEntries.storyId, storyId))
      .all()
      .map((row) => row.id),
  );
  const planIds = new Set(
    tx
      .select({ id: studioPlanItems.id })
      .from(studioPlanItems)
      .where(eq(studioPlanItems.storyId, storyId))
      .all()
      .map((row) => row.id),
  );
  tx.insert(studioEntries)
    .values({
      ...entry,
      relatedEntryIds: entry.relatedEntryIds.filter((id) => entryIds.has(id)),
    })
    .run();
  entryIds.add(entry.id);

  const changes = snapshot.changes
    .filter((change) => planIds.has(change.planItemId))
    .map((change) => ({
      ...change,
      aboutEntryId:
        change.aboutEntryId && entryIds.has(change.aboutEntryId)
          ? change.aboutEntryId
          : null,
    }));
  for (const part of chunk(changes, 50))
    tx.insert(studioChanges).values(part).run();
  for (const part of chunk(snapshot.aboutChangeIds)) {
    tx.update(studioChanges)
      .set({ aboutEntryId: entry.id, updatedAt: now })
      .where(
        and(
          inArray(studioChanges.id, part),
          isNull(studioChanges.aboutEntryId),
        ),
      )
      .run();
  }

  for (const place of snapshot.relatedIn) {
    const row = tx
      .select()
      .from(studioEntries)
      .where(
        and(
          eq(studioEntries.id, place.entryId),
          eq(studioEntries.storyId, storyId),
        ),
      )
      .get();
    if (!row || row.relatedEntryIds.includes(entry.id)) continue;
    tx.update(studioEntries)
      .set({
        relatedEntryIds: insertAt(row.relatedEntryIds, entry.id, place.index),
        revision: row.revision + 1,
        updatedAt: now,
      })
      .where(eq(studioEntries.id, row.id))
      .run();
  }
  for (const place of snapshot.listedIn) {
    const row = tx
      .select()
      .from(studioPlanItems)
      .where(
        and(
          eq(studioPlanItems.id, place.itemId),
          eq(studioPlanItems.storyId, storyId),
        ),
      )
      .get();
    if (!row) continue;
    const next = {
      presentEntryIds: insertAt(row.presentEntryIds, entry.id, place.present),
      contextPinnedEntryIds: insertAt(
        row.contextPinnedEntryIds,
        entry.id,
        place.pinned,
      ),
      contextExcludedEntryIds: insertAt(
        row.contextExcludedEntryIds,
        entry.id,
        place.excluded,
      ),
    };
    if (
      isDeepStrictEqual(next, {
        presentEntryIds: row.presentEntryIds,
        contextPinnedEntryIds: row.contextPinnedEntryIds,
        contextExcludedEntryIds: row.contextExcludedEntryIds,
      })
    )
      continue;
    tx.update(studioPlanItems)
      .set({ ...next, revision: row.revision + 1, updatedAt: now })
      .where(eq(studioPlanItems.id, row.id))
      .run();
  }
  for (const part of chunk(snapshot.dismissedFlagIds)) {
    tx.update(studioFlags)
      .set({ status: "open", updatedAt: now })
      .where(
        and(inArray(studioFlags.id, part), eq(studioFlags.status, "dismissed")),
      )
      .run();
  }
  touchStudioStory(tx, storyId, now);
}

export function insertStudioChange(
  tx: LocalinkTx,
  input: {
    storyId: string;
    entryId: string;
    aspect: StudioAspect;
    mode: StudioChangeMode;
    aboutEntryId?: string | null;
    value: string;
    planItemId: string;
    /**
     * "ai" for an accepted bundle's new record: a planned, AI-written change
     * that read-back may confirm or move, like one from planning.
     */
    provenance?: "ai" | "author";
  },
): StudioChangeDto {
  const now = day().toISOString();
  requireEntry(tx, input.storyId, input.entryId);
  if (input.aboutEntryId) {
    assertEntryIds(tx, input.storyId, [input.aboutEntryId]);
  }
  requirePlanItem(tx, input.storyId, input.planItemId);
  const last = tx
    .select({ value: max(studioChanges.position) })
    .from(studioChanges)
    .where(eq(studioChanges.planItemId, input.planItemId))
    .get();
  const row = tx
    .insert(studioChanges)
    .values({
      id: generateId("studio-change"),
      storyId: input.storyId,
      entryId: input.entryId,
      aboutEntryId: input.aboutEntryId ?? null,
      aspect: input.aspect,
      mode: input.mode,
      value: input.value,
      planItemId: input.planItemId,
      position: (last?.value ?? -1) + 1,
      ...(input.provenance === "ai"
        ? { source: "planned", status: "planned", authorEdited: false }
        : { source: "author", status: "confirmed", authorEdited: true }),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  touchStudioStory(tx, input.storyId, now);
  return toChangeDto(row);
}

export function patchStudioChange(
  tx: LocalinkTx,
  input: {
    storyId: string;
    changeId: string;
    patch: Partial<{
      aspect: StudioAspect;
      mode: StudioChangeMode;
      aboutEntryId: string | null;
      value: string;
      planItemId: string;
    }>;
    /** False for an accepted bundle: the record keeps the ownership it had. */
    markAuthorEdited?: boolean;
  },
): StudioChangeDto {
  const { storyId, changeId, patch } = input;
  const current = tx
    .select()
    .from(studioChanges)
    .where(
      and(eq(studioChanges.id, changeId), eq(studioChanges.storyId, storyId)),
    )
    .get();
  if (!current) {
    throw new ActionError("BAD_REQUEST", "The change could not be found.");
  }
  if (patch.aboutEntryId) assertEntryIds(tx, storyId, [patch.aboutEntryId]);
  const moved = patch.planItemId && patch.planItemId !== current.planItemId;
  if (patch.planItemId) requirePlanItem(tx, storyId, patch.planItemId);
  let position = current.position;
  if (moved && patch.planItemId) {
    const last = tx
      .select({ value: max(studioChanges.position) })
      .from(studioChanges)
      .where(eq(studioChanges.planItemId, patch.planItemId))
      .get();
    position = (last?.value ?? -1) + 1;
  }
  const now = day().toISOString();
  const row = tx
    .update(studioChanges)
    .set({
      ...patch,
      position,
      ...(input.markAuthorEdited === false ? {} : { authorEdited: true }),
      updatedAt: now,
    })
    .where(eq(studioChanges.id, changeId))
    .returning()
    .get();
  touchStudioStory(tx, storyId, now);
  return toChangeDto(row);
}

export function removeStudioChange(
  tx: LocalinkTx,
  storyId: string,
  changeId: string,
): void {
  const current = tx
    .select({ id: studioChanges.id })
    .from(studioChanges)
    .where(
      and(eq(studioChanges.id, changeId), eq(studioChanges.storyId, storyId)),
    )
    .get();
  if (!current) {
    throw new ActionError("BAD_REQUEST", "The change could not be found.");
  }
  tx.delete(studioChanges).where(eq(studioChanges.id, changeId)).run();
  touchStudioStory(tx, storyId, day().toISOString());
}

/**
 * Brings an entry's AI-owned fields in line with a refresh (`refreshAiFields`;
 * author-owned fields are never touched). The entry's revision is the
 * compare-and-swap against the revision the refresh read: a mismatch writes
 * nothing and returns null, since the author's newer edit triggers its own
 * refresh. A cast revision may also carry a new paragraph, written only
 * while the paragraph is still the AI's draft.
 */
export function applyRefreshedEntryFields(
  tx: LocalinkTx,
  input: {
    storyId: string;
    entryId: string;
    sourceRevision: number;
    ops: StudioFieldRefreshOp[];
    summary?: string | null;
  },
): StudioEntryDto | null {
  const current = requireEntry(tx, input.storyId, input.entryId);
  if (current.revision !== input.sourceRevision) return null;
  const currentFields = normalizeEntryFields(current.fields, current.type);
  const { fields } = refreshAiFields(currentFields, input.ops);
  const summary =
    input.summary && current.summaryOrigin === "ai"
      ? input.summary
      : current.summary;
  if (isDeepStrictEqual(fields, currentFields) && summary === current.summary)
    return toEntryDto(current);
  const now = day().toISOString();
  const row = tx
    .update(studioEntries)
    .set({ fields, summary, revision: current.revision + 1, updatedAt: now })
    .where(
      and(
        eq(studioEntries.id, input.entryId),
        eq(studioEntries.storyId, input.storyId),
        eq(studioEntries.revision, input.sourceRevision),
      ),
    )
    .returning()
    .get();
  if (!row) return null;
  touchStudioStory(tx, input.storyId, now);
  return toEntryDto(row);
}
