import "server-only";

import { isDeepStrictEqual } from "node:util";

import { and, eq, max } from "drizzle-orm";

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
  DEFAULT_STORY_GENERATION_MODEL,
  type StoryGenerationModel,
} from "@/lib/story-generation-models";
import {
  EMPTY_STUDIO_STYLE,
  type StudioAspect,
  type StudioChangeDto,
  type StudioEntryDto,
  type StudioEntryField,
  type StudioEntryType,
  type StudioFlagDto,
  type StudioStoryDto,
  type StudioStructureTemplateId,
  type StudioStyle,
  type StudioVoiceSample,
} from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  mergeAiFields,
  normalizeEntryFields,
  type StudioProposedField,
} from "@/lib/studio/entry-fields";
import { generateId } from "@/lib/util";

import {
  assertEntryIds,
  requireEntry,
  requirePlanItem,
  requireStudioStory,
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
    voiceSamples?: StudioVoiceSample[];
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
      voiceSamples: input.voiceSamples ?? [],
      proseModel: DEFAULT_STORY_GENERATION_MODEL,
      style: { ...EMPTY_STUDIO_STYLE },
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
  style: StudioStyle;
  theme: string;
  structureTemplate: StudioStructureTemplateId;
  structureNotes: string;
  voiceSamples: StudioVoiceSample[];
  proseModel: StoryGenerationModel;
}>;

/** Settings fields have a single writer, so the last write wins. */
export function patchStudioStory(
  tx: LocalinkTx,
  storyId: string,
  patch: StudioStoryPatch,
): StudioStoryDto {
  requireStudioStory(tx, storyId);
  const row = tx
    .update(studioStories)
    .set({ ...patch, updatedAt: day().toISOString() })
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
    customTypeLabel?: string;
    relatedEntryIds?: string[];
    fields?: NewStudioEntryField[];
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
      customTypeLabel:
        input.type === "custom" ? (input.customTypeLabel ?? "") : "",
      fields: (input.fields ?? []).map(
        (field): StudioEntryField => ({
          id: generateId("studio-field"),
          label: field.label,
          value: field.value,
          author: "author",
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
  },
): StudioEntryDto {
  const { storyId, entryId, patch } = input;
  const current = requireEntry(tx, storyId, entryId);
  if (patch.relatedEntryIds) assertEntryIds(tx, storyId, patch.relatedEntryIds);

  // The client sends the full desired list. A field that is new or differs
  // from the stored field with the same id is author-written from here on.
  const currentFields = normalizeEntryFields(current.fields, current.type);
  const fields = patch.fields
    ? stampAuthorFields(currentFields, patch.fields)
    : currentFields;
  const next = {
    name: patch.name ?? current.name,
    summary: patch.summary ?? current.summary,
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

export function insertStudioChange(
  tx: LocalinkTx,
  input: {
    storyId: string;
    entryId: string;
    aspect: StudioAspect;
    aboutEntryId?: string | null;
    value: string;
    planItemId: string;
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
      value: input.value,
      planItemId: input.planItemId,
      position: (last?.value ?? -1) + 1,
      source: "author",
      status: "confirmed",
      authorEdited: true,
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
      aboutEntryId: string | null;
      value: string;
      planItemId: string;
    }>;
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
    .set({ ...patch, position, authorEdited: true, updatedAt: now })
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
 * Adds AI-suggested fields to an entry. Author-written fields are never
 * touched (`mergeAiFields`); the entry's revision is the compare-and-swap.
 */
export function applySuggestedEntryFields(
  tx: LocalinkTx,
  input: {
    storyId: string;
    entryId: string;
    expectedRevision: number;
    proposed: StudioProposedField[];
  },
): StudioEntryDto {
  const current = requireEntry(tx, input.storyId, input.entryId);
  if (current.revision !== input.expectedRevision) {
    throw new ActionError(
      "CONFLICT",
      "This entry changed while suggestions were being made. Ask for suggestions again.",
    );
  }
  const currentFields = normalizeEntryFields(current.fields, current.type);
  const fields = mergeAiFields(currentFields, input.proposed);
  if (isDeepStrictEqual(fields, currentFields)) return toEntryDto(current);
  const now = day().toISOString();
  const row = tx
    .update(studioEntries)
    .set({ fields, revision: current.revision + 1, updatedAt: now })
    .where(
      and(
        eq(studioEntries.id, input.entryId),
        eq(studioEntries.storyId, input.storyId),
        eq(studioEntries.revision, input.expectedRevision),
      ),
    )
    .returning()
    .get();
  if (!row) {
    throw new ActionError(
      "CONFLICT",
      "This entry changed while suggestions were being made. Ask for suggestions again.",
    );
  }
  touchStudioStory(tx, input.storyId, now);
  return toEntryDto(row);
}
