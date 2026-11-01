import "server-only";

import { and, desc, eq, max } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioPlanItems,
  studioProse,
  studioProseVersions,
} from "@/lib/drizzle/schema";
import type {
  StudioChangeDto,
  StudioPlanItemDto,
  StudioProseDto,
  StudioProseOrigin,
} from "@/lib/studio/contracts";
import { countWords } from "@/lib/studio/prose-text";
import { generateId } from "@/lib/util";

import {
  applySiblingOrder,
  listSiblingRows,
  requirePlanItem,
  type StudioProseRow,
  selectPlanItemsByIds,
  toChangeDto,
  toPlanItemDto,
  toProseDto,
  touchStudioStory,
} from "./repository";
import { insertPlanItem } from "./repository-plan";

const MOMENT_CONFLICT =
  "This moment changed elsewhere. Your writing has been preserved locally; reload the saved moment before trying again.";
const MOMENT_CONFLICT_RACE =
  "This moment changed elsewhere. Your writing has been preserved locally.";

function getProseRow(
  tx: LocalinkTx,
  momentId: string,
): StudioProseRow | undefined {
  return tx
    .select()
    .from(studioProse)
    .where(eq(studioProse.momentId, momentId))
    .get();
}

type WriteProseInput = {
  storyId: string;
  momentId: string;
  markdown: string;
  expectedRevision: number;
  now: string;
  /** Defaults to "ai-edited" for AI prose and "author" otherwise. */
  origin?: StudioProseOrigin;
  /** Skip the exact-retry shortcut for operations that do more than save text. */
  strict?: boolean;
};

/**
 * Compare-and-swap write of a moment's prose. A missing row counts as
 * revision 0 and is created at revision 1.
 */
function writeProse(tx: LocalinkTx, input: WriteProseInput): StudioProseRow {
  const { storyId, momentId, markdown, now } = input;
  const current = getProseRow(tx, momentId);
  const wordCount = countWords(markdown);

  if (!current) {
    if (input.expectedRevision !== 0)
      throw new ActionError("CONFLICT", MOMENT_CONFLICT);
    return tx
      .insert(studioProse)
      .values({
        momentId,
        storyId,
        markdown,
        origin: input.origin ?? "author",
        revision: 1,
        wordCount,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  // A response may be lost after commit. A retry of that exact body is safe.
  if (!input.strict && current.markdown === markdown) return current;
  if (current.revision !== input.expectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }
  const origin =
    input.origin ?? (current.origin === "ai" ? "ai-edited" : current.origin);
  const row = tx
    .update(studioProse)
    .set({
      markdown,
      origin,
      wordCount,
      revision: current.revision + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(studioProse.momentId, momentId),
        eq(studioProse.storyId, storyId),
        eq(studioProse.revision, input.expectedRevision),
      ),
    )
    .returning()
    .get();
  if (!row) throw new ActionError("CONFLICT", MOMENT_CONFLICT_RACE);
  return row;
}

/** Appends a version when the latest one differs from the current prose. */
function appendVersionIfChanged(
  tx: LocalinkTx,
  storyId: string,
  momentId: string,
  now: string,
): boolean {
  const current = getProseRow(tx, momentId);
  if (!current) return false;
  const latest = tx
    .select({ markdown: studioProseVersions.markdown })
    .from(studioProseVersions)
    .where(eq(studioProseVersions.momentId, momentId))
    .orderBy(desc(studioProseVersions.createdAt), desc(studioProseVersions.id))
    .limit(1)
    .get();
  if (latest && latest.markdown === current.markdown) return false;
  tx.insert(studioProseVersions)
    .values({
      id: generateId("studio-version"),
      storyId,
      momentId,
      markdown: current.markdown,
      origin: current.origin,
      wordCount: current.wordCount,
      createdAt: now,
    })
    .run();
  return true;
}

export function saveMomentProse(
  tx: LocalinkTx,
  input: {
    storyId: string;
    momentId: string;
    markdown: string;
    expectedRevision: number;
  },
): StudioProseDto {
  requirePlanItem(tx, input.storyId, input.momentId, "moment");
  const now = day().toISOString();
  const row = writeProse(tx, { ...input, now });
  touchStudioStory(tx, input.storyId, now);
  return toProseDto(row);
}

/**
 * Persists a kept AI draft: snapshots the text it replaces, writes the draft
 * through the revision compare-and-swap, appends the draft as an "ai"
 * version, and clears the read-back hash so read-back runs next.
 */
export function keepMomentDraft(
  tx: LocalinkTx,
  input: {
    storyId: string;
    momentId: string;
    markdown: string;
    expectedRevision: number;
  },
): StudioProseDto {
  const { storyId, momentId, markdown } = input;
  requirePlanItem(tx, storyId, momentId, "moment");
  const now = day().toISOString();
  const current = getProseRow(tx, momentId);
  // Identical text means a retried Keep whose response was lost.
  if (current && current.markdown === markdown) return toProseDto(current);
  // Check the revision before snapshotting so a stale Keep leaves no trace.
  if ((current?.revision ?? 0) !== input.expectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }
  appendVersionIfChanged(tx, storyId, momentId, now);
  writeProse(tx, {
    storyId,
    momentId,
    markdown,
    expectedRevision: input.expectedRevision,
    origin: "ai",
    now,
    strict: true,
  });
  appendVersionIfChanged(tx, storyId, momentId, now);
  const row = tx
    .update(studioProse)
    .set({ readBackSourceHash: "" })
    .where(eq(studioProse.momentId, momentId))
    .returning()
    .get();
  touchStudioStory(tx, storyId, now);
  return toProseDto(row);
}

export function snapshotMomentProse(
  tx: LocalinkTx,
  storyId: string,
  momentId: string,
): { created: boolean } {
  requirePlanItem(tx, storyId, momentId, "moment");
  return {
    created: appendVersionIfChanged(tx, storyId, momentId, day().toISOString()),
  };
}

export function listProseVersions(
  tx: LocalinkTx,
  storyId: string,
  momentId: string,
): {
  id: string;
  origin: StudioProseOrigin;
  wordCount: number;
  createdAt: string;
}[] {
  requirePlanItem(tx, storyId, momentId, "moment");
  return tx
    .select({
      id: studioProseVersions.id,
      origin: studioProseVersions.origin,
      wordCount: studioProseVersions.wordCount,
      createdAt: studioProseVersions.createdAt,
    })
    .from(studioProseVersions)
    .where(eq(studioProseVersions.momentId, momentId))
    .orderBy(desc(studioProseVersions.createdAt), desc(studioProseVersions.id))
    .all();
}

export function getProseVersionMarkdown(
  tx: LocalinkTx,
  storyId: string,
  versionId: string,
): { markdown: string } {
  const version = tx
    .select({ markdown: studioProseVersions.markdown })
    .from(studioProseVersions)
    .where(
      and(
        eq(studioProseVersions.id, versionId),
        eq(studioProseVersions.storyId, storyId),
      ),
    )
    .get();
  if (!version) {
    throw new ActionError(
      "BAD_REQUEST",
      "The saved version could not be found.",
    );
  }
  return version;
}

export function restoreProseVersion(
  tx: LocalinkTx,
  input: { storyId: string; versionId: string; expectedRevision: number },
): StudioProseDto {
  const { storyId } = input;
  const version = tx
    .select()
    .from(studioProseVersions)
    .where(
      and(
        eq(studioProseVersions.id, input.versionId),
        eq(studioProseVersions.storyId, storyId),
      ),
    )
    .get();
  if (!version) {
    throw new ActionError(
      "BAD_REQUEST",
      "The saved version could not be found.",
    );
  }
  const now = day().toISOString();
  const current = getProseRow(tx, version.momentId);
  // Identical text means a retry (or a no-op); nothing to snapshot or write.
  if (current && current.markdown === version.markdown)
    return toProseDto(current);
  // Check the revision before snapshotting so a stale restore leaves no trace.
  if ((current?.revision ?? 0) !== input.expectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }
  appendVersionIfChanged(tx, storyId, version.momentId, now);
  const row = writeProse(tx, {
    storyId,
    momentId: version.momentId,
    markdown: version.markdown,
    expectedRevision: input.expectedRevision,
    origin: version.origin,
    now,
  });
  touchStudioStory(tx, storyId, now);
  return toProseDto(row);
}

export function splitMoment(
  tx: LocalinkTx,
  input: {
    storyId: string;
    momentId: string;
    expectedRevision: number;
    beforeMarkdown: string;
    afterMarkdown: string;
  },
): { prose: StudioProseDto[]; planItems: StudioPlanItemDto[] } {
  const { storyId, momentId } = input;
  const moment = requirePlanItem(tx, storyId, momentId, "moment");
  const now = day().toISOString();
  const existing = getProseRow(tx, momentId);
  if ((existing?.revision ?? 0) !== input.expectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }
  // Splitting is not an edit of the text, so the origin stays as it was.
  const origin = existing?.origin ?? "author";
  appendVersionIfChanged(tx, storyId, momentId, now);
  const before = writeProse(tx, {
    storyId,
    momentId,
    markdown: input.beforeMarkdown,
    expectedRevision: input.expectedRevision,
    origin,
    now,
    strict: true,
  });
  const { item, shiftedIds } = insertPlanItem(tx, {
    storyId,
    kind: "moment",
    parentId: moment.parentId,
    afterItemId: momentId,
    title: "",
    now,
  });
  // Placeholder title is not an author choice, so it stays out of authorFields.
  tx.update(studioPlanItems)
    .set({ title: "Untitled moment", authorFields: [] })
    .where(eq(studioPlanItems.id, item.id))
    .run();
  const after = tx
    .insert(studioProse)
    .values({
      momentId: item.id,
      storyId,
      markdown: input.afterMarkdown,
      origin,
      revision: 1,
      wordCount: countWords(input.afterMarkdown),
      updatedAt: now,
    })
    .returning()
    .get();
  touchStudioStory(tx, storyId, now);
  const planItems = selectPlanItemsByIds(tx, storyId, [item.id, ...shiftedIds]);
  return {
    prose: [toProseDto(before), toProseDto(after)],
    planItems: planItems.map(toPlanItemDto),
  };
}

export function mergeMomentIntoPrevious(
  tx: LocalinkTx,
  input: {
    storyId: string;
    momentId: string;
    expectedRevision: number;
    previousExpectedRevision: number;
  },
): {
  prose: StudioProseDto[];
  planItems: StudioPlanItemDto[];
  changes: StudioChangeDto[];
  deletedIds: string[];
} {
  const { storyId, momentId } = input;
  const moment = requirePlanItem(tx, storyId, momentId, "moment");
  const siblings = listSiblingRows(tx, storyId, moment.parentId);
  const index = siblings.findIndex((row) => row.id === momentId);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  if (!previous) {
    throw new ActionError(
      "BAD_REQUEST",
      "This is the first moment in its scene, so there is nothing to merge it into.",
    );
  }
  const now = day().toISOString();
  const thisProse = getProseRow(tx, momentId);
  if ((thisProse?.revision ?? 0) !== input.expectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }
  const previousProse = getProseRow(tx, previous.id);
  if ((previousProse?.revision ?? 0) !== input.previousExpectedRevision) {
    throw new ActionError("CONFLICT", MOMENT_CONFLICT);
  }

  const prose: StudioProseDto[] = [];
  const appended = thisProse?.markdown.trim() ?? "";
  if (appended) {
    appendVersionIfChanged(tx, storyId, previous.id, now);
    const base = previousProse?.markdown.trimEnd() ?? "";
    const origin: StudioProseOrigin =
      !previousProse || previousProse.origin === thisProse?.origin
        ? (thisProse?.origin ?? "author")
        : "ai-edited";
    const row = writeProse(tx, {
      storyId,
      momentId: previous.id,
      markdown: base ? `${base}\n\n${appended}` : appended,
      expectedRevision: input.previousExpectedRevision,
      origin,
      now,
      strict: true,
    });
    prose.push(toProseDto(row));
  } else if (previousProse) {
    prose.push(toProseDto(previousProse));
  }

  // Re-pin this moment's changes after the previous moment's own.
  const moved = tx
    .select()
    .from(studioChanges)
    .where(eq(studioChanges.planItemId, momentId))
    .all()
    .sort(
      (a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : 1),
    );
  const last = tx
    .select({ value: max(studioChanges.position) })
    .from(studioChanges)
    .where(eq(studioChanges.planItemId, previous.id))
    .get();
  let nextPosition = (last?.value ?? -1) + 1;
  const changes: StudioChangeDto[] = [];
  for (const change of moved) {
    const row = tx
      .update(studioChanges)
      .set({
        planItemId: previous.id,
        position: nextPosition++,
        updatedAt: now,
      })
      .where(eq(studioChanges.id, change.id))
      .returning()
      .get();
    changes.push(toChangeDto(row));
  }

  // Foreign keys cascade this moment's prose, versions and flags.
  tx.delete(studioPlanItems).where(eq(studioPlanItems.id, momentId)).run();
  const remaining = siblings
    .filter((row) => row.id !== momentId)
    .map((row) => row.id);
  const shifted = applySiblingOrder(
    tx,
    storyId,
    moment.parentId,
    remaining,
    now,
  );
  touchStudioStory(tx, storyId, now);
  return {
    prose,
    planItems: selectPlanItemsByIds(tx, storyId, shifted).map(toPlanItemDto),
    changes,
    deletedIds: [momentId],
  };
}
