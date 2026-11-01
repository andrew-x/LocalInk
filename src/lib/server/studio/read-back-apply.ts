import "server-only";

import { and, eq, inArray, max } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioFlags,
  studioPlanItems,
  studioProse,
} from "@/lib/drizzle/schema";
import type {
  StudioChangeDto,
  StudioFlagDto,
  StudioFlagPayload,
  StudioPlanItemDto,
  StudioProseDto,
} from "@/lib/studio/contracts";
import { hashText } from "@/lib/studio/prose-text";
import type { StagedStudioReadBack } from "@/lib/studio/read-back-contract";
import { generateId } from "@/lib/util";

import {
  chunk,
  requireEntry,
  requirePlanItem,
  type StudioFlagRow,
  toChangeDto,
  toFlagDto,
  toPlanItemDto,
  toProseDto,
  touchStudioStory,
} from "./repository";

export type StudioReadBackApplyResult = {
  applied: boolean;
  workspacePatch: {
    planItems: StudioPlanItemDto[];
    changes: StudioChangeDto[];
    flags: StudioFlagDto[];
    prose: StudioProseDto[];
  };
};

export type StudioFlagResolution = "record" | "dismiss" | "drop";

export type StudioFlagResolveResult = {
  flags: StudioFlagDto[];
  changes: StudioChangeDto[];
  deletedChangeIds: string[];
};

const norm = (value: string) => value.trim().toLowerCase();

function emptyPatch(): StudioReadBackApplyResult["workspacePatch"] {
  return { planItems: [], changes: [], flags: [], prose: [] };
}

function selectOpenFlags(tx: LocalinkTx, storyId: string): StudioFlagRow[] {
  return tx
    .select()
    .from(studioFlags)
    .where(
      and(eq(studioFlags.storyId, storyId), eq(studioFlags.status, "open")),
    )
    .all();
}

function nextChangePosition(tx: LocalinkTx, planItemId: string): number {
  const last = tx
    .select({ value: max(studioChanges.position) })
    .from(studioChanges)
    .where(eq(studioChanges.planItemId, planItemId))
    .get();
  return (last?.value ?? -1) + 1;
}

function existingEntryIds(
  tx: LocalinkTx,
  storyId: string,
  ids: string[],
): Set<string> {
  const found = new Set<string>();
  for (const part of chunk([...new Set(ids)])) {
    for (const row of tx
      .select({ id: studioEntries.id })
      .from(studioEntries)
      .where(
        and(
          eq(studioEntries.storyId, storyId),
          inArray(studioEntries.id, part),
        ),
      )
      .all()) {
      found.add(row.id);
    }
  }
  return found;
}

/**
 * Applies a staged read-back inside the caller's transaction. Returns
 * `applied: false` without touching anything when the prose moved on since the
 * read-back was staged. Changes with `authorEdited` are never modified, and
 * plan fields listed in `authorFields` are never overwritten.
 */
export function applyStagedReadBack(
  tx: LocalinkTx,
  input: { storyId: string; momentId: string; staged: StagedStudioReadBack },
): StudioReadBackApplyResult {
  const { storyId, momentId, staged } = input;
  const { output } = staged;
  const moment = requirePlanItem(tx, storyId, momentId, "moment");
  const proseRow = tx
    .select()
    .from(studioProse)
    .where(
      and(eq(studioProse.momentId, momentId), eq(studioProse.storyId, storyId)),
    )
    .get();
  if (!proseRow || hashText(proseRow.markdown) !== staged.sourceHash) {
    return { applied: false, workspacePatch: emptyPatch() };
  }

  const now = day().toISOString();
  const patch = emptyPatch();
  const touchedChanges = new Map<string, StudioChangeDto>();
  const touchedFlags = new Map<string, StudioFlagDto>();

  const loadChanges = (ids: string[]) => {
    const rows = [];
    for (const part of chunk([...new Set(ids)])) {
      rows.push(
        ...tx
          .select()
          .from(studioChanges)
          .where(
            and(
              eq(studioChanges.storyId, storyId),
              inArray(studioChanges.id, part),
            ),
          )
          .all(),
      );
    }
    return rows;
  };

  // 2. Matched records: confirm those on this moment, and pull the parent
  // scene's unedited ones down to this moment.
  const matchedRows = loadChanges(output.matchedChangeIds);
  for (const row of matchedRows) {
    if (row.authorEdited) continue;
    const onMoment = row.planItemId === momentId;
    const onScene =
      moment.parentId !== null && row.planItemId === moment.parentId;
    if (!onMoment && !onScene) continue;
    if (onMoment && row.status === "confirmed") continue;
    const updated = tx
      .update(studioChanges)
      .set({
        status: "confirmed",
        ...(onScene
          ? { planItemId: momentId, position: nextChangePosition(tx, momentId) }
          : {}),
        updatedAt: now,
      })
      .where(eq(studioChanges.id, row.id))
      .returning()
      .get();
    touchedChanges.set(updated.id, toChangeDto(updated));
  }

  const openFlags = selectOpenFlags(tx, storyId);
  const markFlag = (row: StudioFlagRow) => toFlagDto(row);

  // A matched record no longer needs its "missing" flag.
  const matchedIds = new Set(matchedRows.map((row) => row.id));
  for (const flag of openFlags) {
    if (
      flag.payload.kind === "missing-planned-change" &&
      matchedIds.has(flag.payload.changeId)
    ) {
      const resolved = tx
        .update(studioFlags)
        .set({ status: "resolved", updatedAt: now })
        .where(eq(studioFlags.id, flag.id))
        .returning()
        .get();
      touchedFlags.set(resolved.id, markFlag(resolved));
    }
  }
  // Dismissed flags stay dismissed: they block re-raising just like open ones.
  const dismissedFlags = tx
    .select()
    .from(studioFlags)
    .where(
      and(
        eq(studioFlags.storyId, storyId),
        eq(studioFlags.planItemId, momentId),
        eq(studioFlags.status, "dismissed"),
      ),
    )
    .all();
  const stillOpen = [
    ...openFlags.filter((flag) => !touchedFlags.has(flag.id)),
    ...dismissedFlags,
  ];

  // 3. Missing records: only records still pinned to this moment.
  const openMissing = new Set(
    stillOpen.flatMap((flag) =>
      flag.payload.kind === "missing-planned-change"
        ? [flag.payload.changeId]
        : [],
    ),
  );
  for (const row of loadChanges(output.missingChangeIds)) {
    if (row.planItemId !== momentId || openMissing.has(row.id)) continue;
    openMissing.add(row.id);
    const created = tx
      .insert(studioFlags)
      .values({
        id: generateId("studio-flag"),
        storyId,
        planItemId: momentId,
        kind: "missing-planned-change",
        payload: { kind: "missing-planned-change", changeId: row.id },
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    touchedFlags.set(created.id, markFlag(created));
  }

  // 4. Unplanned changes, skipping ones already recorded or already flagged.
  const entryIds = existingEntryIds(
    tx,
    storyId,
    output.unplannedChanges.flatMap((change) => [
      change.entryId,
      ...(change.aboutEntryId ? [change.aboutEntryId] : []),
    ]),
  );
  const keyOf = (
    entryId: string,
    aspect: string,
    aboutEntryId: string | null,
    value: string,
  ) => JSON.stringify([entryId, aspect, aboutEntryId, norm(value)]);
  const known = new Set<string>();
  for (const flag of stillOpen) {
    if (
      flag.planItemId === momentId &&
      flag.payload.kind === "unplanned-change"
    ) {
      const p = flag.payload;
      known.add(keyOf(p.entryId, p.aspect, p.aboutEntryId, p.value));
    }
  }
  const relevantChanges = tx
    .select()
    .from(studioChanges)
    .where(
      and(
        eq(studioChanges.storyId, storyId),
        inArray(
          studioChanges.planItemId,
          moment.parentId ? [momentId, moment.parentId] : [momentId],
        ),
      ),
    )
    .all();
  for (const change of relevantChanges) {
    known.add(
      keyOf(change.entryId, change.aspect, change.aboutEntryId, change.value),
    );
  }
  for (const change of output.unplannedChanges) {
    if (!entryIds.has(change.entryId)) continue;
    if (change.aboutEntryId && !entryIds.has(change.aboutEntryId)) continue;
    const key = keyOf(
      change.entryId,
      change.aspect,
      change.aboutEntryId,
      change.value,
    );
    if (known.has(key)) continue;
    known.add(key);
    const payload: StudioFlagPayload = {
      kind: "unplanned-change",
      entryId: change.entryId,
      aspect: change.aspect,
      aboutEntryId: change.aboutEntryId,
      value: change.value.trim(),
    };
    const created = tx
      .insert(studioFlags)
      .values({
        id: generateId("studio-flag"),
        storyId,
        planItemId: momentId,
        kind: "unplanned-change",
        payload,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    touchedFlags.set(created.id, markFlag(created));
  }

  // 5. Plan fields: summary always; the rest only when the author has not
  // touched them.
  const set: Partial<typeof studioPlanItems.$inferInsert> = {};
  const summary = output.summary.trim();
  if (summary && summary !== moment.summary) set.summary = summary;
  const whatHappens = output.whatHappens.trim();
  if (
    whatHappens &&
    !moment.authorFields.includes("whatHappens") &&
    whatHappens !== moment.whatHappens
  ) {
    set.whatHappens = whatHappens;
  }
  if (
    output.presentEntryIds.length > 0 &&
    !moment.authorFields.includes("presentEntryIds")
  ) {
    const valid = existingEntryIds(tx, storyId, output.presentEntryIds);
    const present = output.presentEntryIds.filter((entryId) =>
      valid.has(entryId),
    );
    if (
      present.length > 0 &&
      JSON.stringify(present) !== JSON.stringify(moment.presentEntryIds)
    ) {
      set.presentEntryIds = present;
    }
  }
  if (Object.keys(set).length > 0) {
    const updated = tx
      .update(studioPlanItems)
      .set({
        ...set,
        // Summary is not editable by the author, so a summary-only refresh
        // must not invalidate concurrent plan-item saves.
        ...(Object.keys(set).some((key) => key !== "summary")
          ? { revision: moment.revision + 1 }
          : {}),
        updatedAt: now,
      })
      .where(eq(studioPlanItems.id, momentId))
      .returning()
      .get();
    patch.planItems.push(toPlanItemDto(updated));
  }

  // 6. Read-back bookkeeping. Revision stays put so autosave is unaffected.
  const proseUpdated = tx
    .update(studioProse)
    .set({
      readBackSourceHash: staged.sourceHash,
      readBackSentenceHashes: staged.sentenceHashes,
    })
    .where(eq(studioProse.momentId, momentId))
    .returning()
    .get();
  patch.prose.push(toProseDto(proseUpdated));

  patch.changes = [...touchedChanges.values()];
  patch.flags = [...touchedFlags.values()];
  touchStudioStory(tx, storyId, now);
  return { applied: true, workspacePatch: patch };
}

export function resolveStudioFlagInTx(
  tx: LocalinkTx,
  input: {
    storyId: string;
    flagId: string;
    resolution: StudioFlagResolution;
  },
): StudioFlagResolveResult {
  const { storyId, flagId, resolution } = input;
  const flag = tx
    .select()
    .from(studioFlags)
    .where(and(eq(studioFlags.id, flagId), eq(studioFlags.storyId, storyId)))
    .get();
  if (!flag) {
    throw new ActionError("BAD_REQUEST", "The flag could not be found.");
  }
  // Idempotent: a flag that is already settled stays as it is.
  if (flag.status !== "open") {
    return { flags: [toFlagDto(flag)], changes: [], deletedChangeIds: [] };
  }

  const now = day().toISOString();
  const payload = flag.payload;
  const changes: StudioChangeDto[] = [];
  const deletedChangeIds: string[] = [];
  const settle = (ids: string[], status: "resolved" | "dismissed") =>
    ids.map((id) =>
      toFlagDto(
        tx
          .update(studioFlags)
          .set({ status, updatedAt: now })
          .where(eq(studioFlags.id, id))
          .returning()
          .get(),
      ),
    );

  if (resolution === "record") {
    if (payload.kind !== "unplanned-change") {
      throw new ActionError(
        "BAD_REQUEST",
        "Only a change that was not planned can be recorded.",
      );
    }
    requirePlanItem(tx, storyId, flag.planItemId);
    requireEntry(tx, storyId, payload.entryId);
    if (payload.aboutEntryId) requireEntry(tx, storyId, payload.aboutEntryId);
    const created = tx
      .insert(studioChanges)
      .values({
        id: generateId("studio-change"),
        storyId,
        entryId: payload.entryId,
        aboutEntryId: payload.aboutEntryId,
        aspect: payload.aspect,
        value: payload.value,
        planItemId: flag.planItemId,
        position: nextChangePosition(tx, flag.planItemId),
        source: "read-back",
        status: "confirmed",
        authorEdited: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    changes.push(toChangeDto(created));
    const flags = settle([flag.id], "resolved");
    touchStudioStory(tx, storyId, now);
    return { flags, changes, deletedChangeIds };
  }

  if (resolution === "drop") {
    if (payload.kind !== "missing-planned-change") {
      throw new ActionError(
        "BAD_REQUEST",
        "Only a planned change that is missing can be dropped.",
      );
    }
    tx.delete(studioChanges)
      .where(
        and(
          eq(studioChanges.id, payload.changeId),
          eq(studioChanges.storyId, storyId),
        ),
      )
      .run();
    deletedChangeIds.push(payload.changeId);
    // Any other open flag about the same record is moot now.
    const siblings = selectOpenFlags(tx, storyId)
      .filter(
        (item) =>
          item.payload.kind === "missing-planned-change" &&
          item.payload.changeId === payload.changeId,
      )
      .map((item) => item.id);
    const flags = settle(
      siblings.length > 0 ? siblings : [flag.id],
      "resolved",
    );
    touchStudioStory(tx, storyId, now);
    return { flags, changes, deletedChangeIds };
  }

  const flags = settle([flag.id], "dismissed");
  touchStudioStory(tx, storyId, now);
  return { flags, changes, deletedChangeIds };
}
