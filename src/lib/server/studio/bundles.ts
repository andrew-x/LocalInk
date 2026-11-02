import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioBundles } from "@/lib/drizzle/schema";
import {
  bundleStatusOf,
  expandStudioBundleAccept,
  type StudioBundleDecision,
  type StudioBundleDismissal,
  type StudioBundleDto,
  type StudioBundleOp,
  type StudioBundleOpInput,
  type StudioBundleResolution,
  type StudioBundleSelectionCheck,
  type StudioBundleSource,
  studioBundleOpsInputSchema,
  studioBundlePendingDependents,
  validateStudioBundleOps,
} from "@/lib/studio/bundle-contract";
import { generateId } from "@/lib/util";

import { createAspectModeResolver } from "./aspect-modes";
import { applyBundleOp, flushDeferredRelations } from "./bundle-apply";
import {
  acceptedBundleRefs,
  type BundleApplyContext,
  captureStoryRows,
  diffStoryRows,
  emptyWorkspacePatch,
  listMentions,
  nextBundleOpSeq,
  opMentions,
  readOpResult,
} from "./bundle-kit";
import {
  findBundleSelectionIssues,
  findCleanPendingOps,
  orderBundleOpsForApply,
  precheckBundleAccept,
  rebaseBundleOps,
} from "./bundle-precheck";
import { undoBundleOp } from "./bundle-undo";
import {
  bundleOpsOf,
  requireStudioStory,
  type StudioBundleRow,
  toBundleDto,
  touchStudioStory,
} from "./repository";

const MAX_SUMMARY_CHARS = 2000;

export type StudioBundleInsertInput = {
  storyId: string;
  source: StudioBundleSource;
  threadId: string | null;
  messageId: string | null;
  generationId: string;
  summary: string;
  /** Validated here; status and result are set by the bundle itself. */
  operations: StudioBundleOpInput[];
  /**
   * When the ops' baselines were captured (a chat turn's start), stored as
   * createdAt. Delete pre-checks treat later writes as conflicts, so this
   * must not be later than the earliest baseline. Defaults to now.
   */
  proposedAt?: string;
};

/**
 * Stores a proposed bundle as pending. Ops are parsed and checked against
 * each other; saved ids are checked against the story only at accept time.
 * A second bundle for the same generation is refused: look it up with
 * `getStudioBundleByGeneration` first to make a retried save idempotent.
 */
export function insertStudioBundle(
  tx: LocalinkTx,
  input: StudioBundleInsertInput,
): StudioBundleDto {
  requireStudioStory(tx, input.storyId);
  const parsed = studioBundleOpsInputSchema.safeParse(input.operations);
  if (!parsed.success) {
    throw new ActionError(
      "BAD_REQUEST",
      "The proposed changes could not be saved because they are not valid.",
    );
  }
  const problems = validateStudioBundleOps(parsed.data);
  if (problems.length > 0) {
    throw new ActionError(
      "BAD_REQUEST",
      `The proposed changes could not be saved: ${problems[0]}`,
    );
  }
  const duplicate = tx
    .select({ id: studioBundles.id })
    .from(studioBundles)
    .where(eq(studioBundles.generationId, input.generationId))
    .get();
  if (duplicate) {
    throw new ActionError(
      "CONFLICT",
      "These proposed changes were already saved.",
    );
  }
  const now = day().toISOString();
  const operations = parsed.data.map(
    (op): StudioBundleOp => ({ ...op, status: "pending" }),
  );
  const row = tx
    .insert(studioBundles)
    .values({
      id: generateId("studio-bundle"),
      storyId: input.storyId,
      source: input.source,
      threadId: input.threadId,
      messageId: input.messageId,
      generationId: input.generationId,
      summary: input.summary.trim().slice(0, MAX_SUMMARY_CHARS),
      operations,
      status: "pending",
      createdAt:
        input.proposedAt && input.proposedAt < now ? input.proposedAt : now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toBundleDto(row);
}

export function getStudioBundleByGeneration(
  tx: LocalinkTx,
  storyId: string,
  generationId: string,
): StudioBundleDto | null {
  const row = tx
    .select()
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.storyId, storyId),
        eq(studioBundles.generationId, generationId),
      ),
    )
    .get();
  return row ? toBundleDto(row) : null;
}

/** A decision with nothing left to do that is not a retry of itself. */
function nothingLeft(message: string): ActionError {
  return new ActionError(
    "BAD_REQUEST",
    `${message} Reload to see where things stand.`,
  );
}

/**
 * A retry of a decision that already went through changes nothing. The
 * client learns it is a replay so it can reload instead of trusting the
 * empty patch (the first response, with the real patch, may have been lost).
 */
function replayed(row: StudioBundleRow): StudioBundleResolution {
  return {
    bundle: toBundleDto(row),
    workspacePatch: emptyWorkspacePatch(),
    replayed: true,
  };
}

function requireBundle(
  tx: LocalinkTx,
  storyId: string,
  bundleId: string,
): StudioBundleRow {
  const row = tx
    .select()
    .from(studioBundles)
    .where(
      and(eq(studioBundles.id, bundleId), eq(studioBundles.storyId, storyId)),
    )
    .get();
  if (!row) {
    throw new ActionError(
      "BAD_REQUEST",
      "These proposed changes could not be found.",
    );
  }
  return row;
}

/** The ops a decision names (every op when null), each checked to exist. */
function requestedOps(
  ops: StudioBundleOp[],
  opIds: string[] | null,
): StudioBundleOp[] {
  if (opIds === null) return ops;
  const ids = new Set(opIds);
  if (ids.size === 0) {
    throw new ActionError("BAD_REQUEST", "Select at least one change.");
  }
  const requested = ops.filter((op) => ids.has(op.id));
  if (requested.length !== ids.size) {
    throw new ActionError(
      "BAD_REQUEST",
      "Some selected changes are not part of this proposal. Reload and try again.",
    );
  }
  return requested;
}

/**
 * What accepting `opIds` (null: everything pending) applies: the requested
 * ops still pending plus, transitively, the pending creates they need.
 * Accept and the selection check share it so they cannot drift.
 */
function acceptSelection(
  ops: StudioBundleOp[],
  opIds: string[] | null,
): { requested: StudioBundleOp[]; selected: Set<string> } {
  const requested = requestedOps(ops, opIds);
  return {
    requested,
    selected: expandStudioBundleAccept(
      ops,
      requested.map((op) => op.id),
    ),
  };
}

/** Marks the pending ops among `opIds` rejected. */
function dismissOps(
  ops: StudioBundleOp[],
  opIds: Set<string>,
  by: StudioBundleDismissal,
): StudioBundleOp[] {
  return ops.map(
    (op): StudioBundleOp =>
      opIds.has(op.id) && op.status === "pending"
        ? { ...op, status: "rejected", dismissedBy: by }
        : op,
  );
}

/** Stores the ops and the bundle status they add up to. */
function saveBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
  operations: StudioBundleOp[],
  now: string,
): StudioBundleDto {
  return toBundleDto(
    tx
      .update(studioBundles)
      .set({ operations, status: bundleStatusOf(operations), updatedAt: now })
      .where(eq(studioBundles.id, row.id))
      .returning()
      .get(),
  );
}

function applyNamed(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOp,
  mention: string,
): object {
  try {
    return applyBundleOp(tx, ctx, op);
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    throw new ActionError(
      error.code,
      `${mention} could not be applied: ${error.publicMessage}`,
    );
  }
}

/**
 * Applies the selection (see `acceptSelection`) while the rest stays
 * pending. Creates accepted earlier resolve their temp ids, and `seq`
 * continues from earlier accepts. Afterwards the still-pending ops that
 * were clean before this accept are rebased onto what it wrote, so the
 * bundle's own writes never make a later accept conflict.
 */
function acceptBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
  opIds: string[] | null,
): StudioBundleResolution {
  const ops = bundleOpsOf(row);
  const mentions = opMentions(ops);
  const { requested, selected } = acceptSelection(ops, opIds);
  if (opIds !== null) {
    const dismissed = requested.filter(
      (op) => op.status === "rejected" || op.status === "undone",
    );
    if (dismissed.length > 0) {
      throw nothingLeft(
        `${listMentions(dismissed.map((op) => mentions.get(op.id) ?? op.label))} ${dismissed.length === 1 ? "was" : "were"} already dismissed or undone.`,
      );
    }
  }
  if (selected.size === 0) {
    // Everything requested is already applied: a retried accept.
    if (requested.some((op) => op.status === "accepted")) return replayed(row);
    throw nothingLeft(
      ops.some((op) => op.status === "undone")
        ? "These changes were already undone."
        : "These changes were already discarded.",
    );
  }

  const before = captureStoryRows(tx, row.storyId);
  precheckBundleAccept(ops, selected, before, row.createdAt);
  const rebase = findCleanPendingOps(ops, before, row.createdAt);
  const now = day().toISOString();
  const ctx: BundleApplyContext = {
    storyId: row.storyId,
    now,
    refs: acceptedBundleRefs(ops),
    modes: createAspectModeResolver(tx, row.storyId),
    deferredRelated: [],
  };
  const results = new Map<string, object>();
  let seq = nextBundleOpSeq(ops);
  for (const op of orderBundleOpsForApply(
    ops.filter((op) => selected.has(op.id)),
    before,
  )) {
    results.set(op.id, {
      ...applyNamed(tx, ctx, op, mentions.get(op.id) ?? op.label),
      seq: seq++,
    });
  }
  flushDeferredRelations(tx, ctx);
  touchStudioStory(tx, row.storyId, now);

  const after = captureStoryRows(tx, row.storyId);
  const applied = ops.map(
    (op): StudioBundleOp =>
      selected.has(op.id)
        ? { ...op, status: "accepted", result: results.get(op.id) }
        : op,
  );
  return {
    bundle: saveBundle(
      tx,
      row,
      rebaseBundleOps(applied, rebase, after, day().toISOString()),
      now,
    ),
    workspacePatch: diffStoryRows(before, after),
    replayed: false,
  };
}

/**
 * Dismisses the requested pending ops (null: every pending op) and the
 * pending ops that depend on them, which could never apply. Accepted ops
 * are left as they are.
 */
function rejectBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
  opIds: string[] | null,
): StudioBundleResolution {
  const ops = bundleOpsOf(row);
  const requested = requestedOps(ops, opIds);
  const roots = requested
    .filter((op) => op.status === "pending")
    .map((op) => op.id);
  if (roots.length === 0) {
    if (requested.some((op) => op.status === "rejected")) return replayed(row);
    throw nothingLeft(
      requested.some((op) => op.status === "accepted")
        ? "These changes were already accepted."
        : "These changes were already undone.",
    );
  }
  const dismissed = new Set([
    ...roots,
    ...studioBundlePendingDependents(ops, roots),
  ]);
  return {
    bundle: saveBundle(
      tx,
      row,
      dismissOps(ops, dismissed, "author"),
      day().toISOString(),
    ),
    workspacePatch: emptyWorkspacePatch(),
    replayed: false,
  };
}

/**
 * Reverses every accepted op, last applied first across all of the
 * bundle's accepts. Each op checks that what it wrote is still in place;
 * every op that fails is named and nothing is kept (the caller's
 * transaction rolls back). Pending ops stay pending, except those that need
 * a create being undone, which are dismissed; the rest are rebased as after
 * an accept, since undo is this bundle's own write too.
 */
function undoBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
): StudioBundleResolution {
  const ops = bundleOpsOf(row);
  const accepted = ops
    .filter((op) => op.status === "accepted")
    .map((op) => ({ op, seq: readOpResult(op)?.seq ?? -1 }))
    .sort((a, b) => b.seq - a.seq);
  if (accepted.length === 0) {
    if (ops.some((op) => op.status === "undone")) return replayed(row);
    throw nothingLeft(
      ops.some((op) => op.status === "pending")
        ? "These changes have not been accepted yet, so there is nothing to undo."
        : "These changes were already discarded.",
    );
  }
  const before = captureStoryRows(tx, row.storyId);
  const rebase = findCleanPendingOps(ops, before, row.createdAt);
  const now = day().toISOString();
  const ctx = { storyId: row.storyId, now };
  const mentions = opMentions(ops);
  const conflicts: string[] = [];
  for (const { op } of accepted) {
    let undone = false;
    try {
      undone = undoBundleOp(tx, ctx, op);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
    }
    if (!undone) conflicts.push(mentions.get(op.id) ?? op.label);
  }
  if (conflicts.length > 0) {
    throw new ActionError(
      "CONFLICT",
      `These can't be undone because the story changed after they were accepted: ${listMentions(conflicts)}.`,
    );
  }
  touchStudioStory(tx, row.storyId, now);

  const after = captureStoryRows(tx, row.storyId);
  const undoneIds = new Set(accepted.map(({ op }) => op.id));
  const undone = dismissOps(
    ops.map(
      (op): StudioBundleOp =>
        undoneIds.has(op.id) ? { ...op, status: "undone" } : op,
    ),
    studioBundlePendingDependents(ops, undoneIds),
    "author",
  );
  return {
    bundle: saveBundle(
      tx,
      row,
      rebaseBundleOps(undone, rebase, after, day().toISOString()),
      now,
    ),
    workspacePatch: diffStoryRows(before, after),
    replayed: false,
  };
}

/**
 * Accepts or rejects ops of a bundle (`opIds`, or every pending op when
 * null) while the rest stays pending, or undoes everything accepted so far
 * (`opIds` ignored). Run it inside one transaction: accept checks every
 * baseline before writing and applies its selection atomically. Each
 * decision is idempotent once its target state is reached, returning the
 * bundle, an empty patch, and `replayed: true`. The bundle's status is
 * always `bundleStatusOf` its ops.
 */
export function resolveStudioBundle(
  tx: LocalinkTx,
  input: {
    storyId: string;
    bundleId: string;
    decision: StudioBundleDecision;
    /** Accept and reject; null means every pending op. Undo ignores it. */
    opIds: string[] | null;
  },
): StudioBundleResolution {
  const row = requireBundle(tx, input.storyId, input.bundleId);
  switch (input.decision) {
    case "accept":
      return acceptBundle(tx, row, input.opIds);
    case "reject":
      return rejectBundle(tx, row, input.opIds);
    case "undo":
      return undoBundle(tx, row);
  }
}

/**
 * Every problem with accepting `opIds` (all pending when null) right now,
 * by op id, without writing. It expands the selection exactly as accept
 * does; when nothing would be applied there is nothing to check. The UI
 * calls this after a failed accept to mark the ops that cannot go in.
 */
export function checkStudioBundleSelection(
  tx: LocalinkTx,
  input: { storyId: string; bundleId: string; opIds: string[] | null },
): StudioBundleSelectionCheck {
  const row = requireBundle(tx, input.storyId, input.bundleId);
  const ops = bundleOpsOf(row);
  const { selected } = acceptSelection(ops, input.opIds);
  if (selected.size === 0) return { issues: [] };
  return {
    issues: findBundleSelectionIssues(
      ops,
      selected,
      captureStoryRows(tx, row.storyId),
      row.createdAt,
    ),
  };
}

/**
 * Dismisses, without review, every op still pending in any bundle of the
 * story (every thread): sending a new chat message clears what is still
 * waiting, so at most one proposal has pending suggestions at a time.
 * Accepted ops stay accepted and undoable. Returns the bundles it changed.
 */
export function dismissPendingStudioBundles(
  tx: LocalinkTx,
  storyId: string,
): StudioBundleDto[] {
  const now = day().toISOString();
  return tx
    .select()
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.storyId, storyId),
        eq(studioBundles.status, "pending"),
      ),
    )
    .orderBy(asc(studioBundles.createdAt), asc(studioBundles.id))
    .all()
    .map((row) => {
      const ops = bundleOpsOf(row);
      return saveBundle(
        tx,
        row,
        dismissOps(ops, new Set(ops.map((op) => op.id)), "new-message"),
        now,
      );
    });
}
