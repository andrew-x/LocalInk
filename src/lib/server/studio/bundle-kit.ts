import "server-only";

import { isDeepStrictEqual } from "node:util";

import { eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioFlags,
  studioPlanItems,
  studioProse,
} from "@/lib/drizzle/schema";
import {
  isStudioBundleTempRef,
  type StudioBundleOpKind,
  type StudioBundleOpOf,
  type StudioBundleStoryPatch,
  type StudioBundleWorkspacePatch,
} from "@/lib/studio/bundle-contract";
import type {
  StudioChangeMode,
  StudioEntryField,
  StudioProseOrigin,
} from "@/lib/studio/contracts";

import type { AspectModeResolver } from "./aspect-modes";
import {
  requireStudioStory,
  type StudioChangeRow,
  type StudioDeletedSubtree,
  type StudioEntryRow,
  type StudioFlagRow,
  type StudioPlanItemRow,
  type StudioProseRow,
  type StudioStoryRow,
  toChangeDto,
  toEntryDto,
  toFlagDto,
  toPlanItemDto,
  toProseDto,
  toStoryDto,
} from "./repository";
import type { StudioDeletedEntry } from "./repository-bible";
import type { StudioPlanItemPatch } from "./repository-plan";

/** Every row of one story, keyed by id (prose by moment id). */
export type StudioStoryRows = {
  story: StudioStoryRow;
  entries: Map<string, StudioEntryRow>;
  planItems: Map<string, StudioPlanItemRow>;
  changes: Map<string, StudioChangeRow>;
  prose: Map<string, StudioProseRow>;
  flags: Map<string, StudioFlagRow>;
};

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Reads the whole story. Accept and undo read it before and after writing:
 * the "before" copy is what baselines are checked against, and the
 * difference is the workspace patch, so no helper has to report what it
 * touched (sibling renumbering, stripped references, dismissed flags).
 */
export function captureStoryRows(
  tx: LocalinkTx,
  storyId: string,
): StudioStoryRows {
  return {
    story: requireStudioStory(tx, storyId),
    entries: byId(
      tx
        .select()
        .from(studioEntries)
        .where(eq(studioEntries.storyId, storyId))
        .all(),
    ),
    planItems: byId(
      tx
        .select()
        .from(studioPlanItems)
        .where(eq(studioPlanItems.storyId, storyId))
        .all(),
    ),
    changes: byId(
      tx
        .select()
        .from(studioChanges)
        .where(eq(studioChanges.storyId, storyId))
        .all(),
    ),
    prose: new Map(
      tx
        .select()
        .from(studioProse)
        .where(eq(studioProse.storyId, storyId))
        .all()
        .map((row) => [row.momentId, row]),
    ),
    flags: byId(
      tx
        .select()
        .from(studioFlags)
        .where(eq(studioFlags.storyId, storyId))
        .all(),
    ),
  };
}

function changedRows<T>(before: Map<string, T>, after: Map<string, T>): T[] {
  const rows: T[] = [];
  for (const [id, row] of after) {
    const previous = before.get(id);
    if (!previous || !isDeepStrictEqual(previous, row)) rows.push(row);
  }
  return rows;
}

function removedIds<T>(before: Map<string, T>, after: Map<string, T>) {
  return [...before.keys()].filter((id) => !after.has(id));
}

export function emptyWorkspacePatch(): StudioBundleWorkspacePatch {
  return {
    entries: [],
    planItems: [],
    changes: [],
    prose: [],
    flags: [],
    removed: { planItemIds: [], entryIds: [], changeIds: [] },
  };
}

/**
 * The rows that differ. The story is included only when a setting changed,
 * not for a timestamp touch, so an open settings form is not replaced.
 */
export function diffStoryRows(
  before: StudioStoryRows,
  after: StudioStoryRows,
): StudioBundleWorkspacePatch {
  const storyChanged = !isDeepStrictEqual(
    { ...before.story, updatedAt: "" },
    { ...after.story, updatedAt: "" },
  );
  return {
    ...(storyChanged ? { story: toStoryDto(after.story) } : {}),
    entries: changedRows(before.entries, after.entries).map(toEntryDto),
    planItems: changedRows(before.planItems, after.planItems).map(
      toPlanItemDto,
    ),
    changes: changedRows(before.changes, after.changes).map(toChangeDto),
    prose: changedRows(before.prose, after.prose).map(toProseDto),
    flags: changedRows(before.flags, after.flags).map(toFlagDto),
    removed: {
      planItemIds: removedIds(before.planItems, after.planItems),
      entryIds: removedIds(before.entries, after.entries),
      changeIds: removedIds(before.changes, after.changes),
    },
  };
}

/** Op labels for a user-facing message: quoted, clipped, at most six. */
export function quoteOpLabels(labels: string[]): string {
  const unique = [...new Set(labels)];
  const shown = unique
    .slice(0, 6)
    .map(
      (label) => `“${label.length > 80 ? `${label.slice(0, 79)}…` : label}”`,
    );
  return unique.length > 6
    ? `${shown.join(", ")} and ${unique.length - 6} more`
    : shown.join(", ");
}

export type StudioEntryContent = {
  name: string;
  summary: string;
  fields: StudioEntryField[];
};

export type StudioChangeValues = {
  aspect: string;
  mode: StudioChangeMode;
  value: string;
  aboutEntryId: string | null;
};

/** Change-record fields as written (temp ids already resolved). */
export type StudioChangeFields = Partial<
  StudioChangeValues & { planItemId: string }
>;

/**
 * What each accepted op records for undo. Stored in the op's `result`
 * (so undo survives a restart), with `seq`, its place in the apply order.
 * Create ops name the real id as `createdId`.
 */
export type StudioBundleOpResults = {
  "story.update": {
    before: StudioBundleStoryPatch;
    after: StudioBundleStoryPatch;
  };
  "entry.create": { createdId: string; after: StudioEntryContent };
  "entry.update": {
    entryId: string;
    before: Partial<StudioEntryContent>;
    after: Partial<StudioEntryContent>;
  };
  "entry.delete": { snapshot: StudioDeletedEntry };
  "plan.create": {
    createdId: string;
    after: {
      whatHappens: string;
      howToWrite: string;
      craft: Record<string, string>;
    };
  };
  "plan.update": { before: StudioPlanItemPatch; after: StudioPlanItemPatch };
  "plan.move": {
    before: { parentId: string | null; index: number };
    after: { parentId: string | null };
  };
  "plan.delete": { snapshot: StudioDeletedSubtree };
  "change.create": { createdId: string; after: StudioChangeValues };
  "change.update": { before: StudioChangeFields; after: StudioChangeFields };
  "change.delete": { row: StudioChangeRow };
  "prose.write": {
    momentId: string;
    /** Null when the moment had no prose row. */
    before: { markdown: string; origin: StudioProseOrigin } | null;
    /** Null when the text was already identical, so nothing was written. */
    revisionAfter: number | null;
  };
};

export type StoredOpResult<K extends StudioBundleOpKind> =
  StudioBundleOpResults[K] & { seq: number };

export function readOpResult<K extends StudioBundleOpKind>(
  op: StudioBundleOpOf<K>,
): StoredOpResult<K> | null {
  const { result } = op;
  if (typeof result !== "object" || result === null) return null;
  return typeof (result as { seq?: unknown }).seq === "number"
    ? (result as StoredOpResult<K>)
    : null;
}

export type BundleApplyContext = {
  storyId: string;
  now: string;
  /** Temp id to real id, filled in as create ops run. */
  refs: Map<string, string>;
  modes: AspectModeResolver;
  /**
   * New entries related to new entries created later in the bundle (or to
   * each other): their related lists are set once every entry exists.
   */
  deferredRelated: { entryId: string; refs: string[] }[];
};

export function resolveRef(ctx: BundleApplyContext, ref: string): string {
  if (!isStudioBundleTempRef(ref)) return ref;
  const id = ctx.refs.get(ref);
  if (!id) {
    throw new ActionError(
      "BAD_REQUEST",
      "It depends on a change that was not applied.",
    );
  }
  return id;
}

export function pickKeys<T extends object, K extends keyof T>(
  source: T,
  keys: K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<
    T,
    K
  >;
}
