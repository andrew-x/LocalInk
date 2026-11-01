import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioBundles } from "@/lib/drizzle/schema";
import {
  type StudioBundleDecision,
  type StudioBundleDto,
  type StudioBundleOp,
  type StudioBundleOpInput,
  type StudioBundleResolution,
  type StudioBundleSource,
  type StudioBundleStatus,
  studioBundleOpsInputSchema,
  validateStudioBundleOps,
} from "@/lib/studio/bundle-contract";
import { generateId } from "@/lib/util";

import { createAspectModeResolver } from "./aspect-modes";
import { applyBundleOp, flushDeferredRelations } from "./bundle-apply";
import {
  type BundleApplyContext,
  captureStoryRows,
  diffStoryRows,
  emptyWorkspacePatch,
  quoteOpLabels,
  readOpResult,
} from "./bundle-kit";
import {
  orderBundleOpsForApply,
  precheckBundleAccept,
} from "./bundle-precheck";
import { undoBundleOp } from "./bundle-undo";
import {
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
      createdAt: now,
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

function alreadyResolved(status: StudioBundleStatus): ActionError {
  const message: Record<StudioBundleStatus, string> = {
    pending:
      "These changes have not been accepted yet, so there is nothing to undo.",
    accepted: "These changes were already accepted.",
    "partially-accepted": "These changes were already accepted.",
    rejected: "These changes were already discarded.",
    undone: "These changes were already undone.",
  };
  return new ActionError(
    "BAD_REQUEST",
    `${message[status]} Reload to see where things stand.`,
  );
}

/** A retry of a decision that already went through changes nothing. */
function unchanged(row: StudioBundleRow): StudioBundleResolution {
  return { bundle: toBundleDto(row), workspacePatch: emptyWorkspacePatch() };
}

function saveBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
  operations: StudioBundleOp[],
  status: StudioBundleStatus,
  now: string,
): StudioBundleDto {
  return toBundleDto(
    tx
      .update(studioBundles)
      .set({ operations, status, updatedAt: now })
      .where(eq(studioBundles.id, row.id))
      .returning()
      .get(),
  );
}

function applyNamed(
  tx: LocalinkTx,
  ctx: BundleApplyContext,
  op: StudioBundleOp,
): object {
  try {
    return applyBundleOp(tx, ctx, op);
  } catch (error) {
    if (!(error instanceof ActionError)) throw error;
    throw new ActionError(
      error.code,
      `${quoteOpLabels([op.label])} could not be applied: ${error.publicMessage}`,
    );
  }
}

function acceptBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
  opIds: string[] | null,
): StudioBundleResolution {
  if (row.status === "accepted" || row.status === "partially-accepted") {
    return unchanged(row);
  }
  if (row.status !== "pending") throw alreadyResolved(row.status);
  const ops = row.operations;
  const known = new Set(ops.map((op) => op.id));
  const selected = new Set(opIds ?? known);
  if (selected.size === 0) {
    throw new ActionError("BAD_REQUEST", "Select at least one change.");
  }
  if ([...selected].some((id) => !known.has(id))) {
    throw new ActionError(
      "BAD_REQUEST",
      "Some selected changes are not part of this proposal. Reload and try again.",
    );
  }

  const before = captureStoryRows(tx, row.storyId);
  precheckBundleAccept(ops, selected, before);
  const now = day().toISOString();
  const ctx: BundleApplyContext = {
    storyId: row.storyId,
    now,
    refs: new Map(),
    modes: createAspectModeResolver(tx, row.storyId),
    deferredRelated: [],
  };
  const results = new Map<string, object>();
  orderBundleOpsForApply(
    ops.filter((op) => selected.has(op.id)),
    before,
  ).forEach((op, seq) => {
    results.set(op.id, { ...applyNamed(tx, ctx, op), seq });
  });
  flushDeferredRelations(tx, ctx);
  touchStudioStory(tx, row.storyId, now);

  const operations = ops.map(
    (op): StudioBundleOp =>
      selected.has(op.id)
        ? { ...op, status: "accepted", result: results.get(op.id) }
        : { ...op, status: "rejected" },
  );
  const bundle = saveBundle(
    tx,
    row,
    operations,
    selected.size === ops.length ? "accepted" : "partially-accepted",
    now,
  );
  return {
    bundle,
    workspacePatch: diffStoryRows(before, captureStoryRows(tx, row.storyId)),
  };
}

function rejectBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
): StudioBundleResolution {
  if (row.status === "rejected") return unchanged(row);
  if (row.status !== "pending") throw alreadyResolved(row.status);
  const operations = row.operations.map(
    (op): StudioBundleOp => ({ ...op, status: "rejected" }),
  );
  return {
    bundle: saveBundle(tx, row, operations, "rejected", day().toISOString()),
    workspacePatch: emptyWorkspacePatch(),
  };
}

/**
 * Reverses accepted ops, last applied first. Each op checks that what it
 * wrote is still in place; every op that fails is named and nothing is
 * kept (the caller's transaction rolls back).
 */
function undoBundle(
  tx: LocalinkTx,
  row: StudioBundleRow,
): StudioBundleResolution {
  if (row.status === "undone") return unchanged(row);
  if (row.status !== "accepted" && row.status !== "partially-accepted") {
    throw alreadyResolved(row.status);
  }
  const before = captureStoryRows(tx, row.storyId);
  const now = day().toISOString();
  const ctx = { storyId: row.storyId, now };
  const accepted = row.operations
    .filter((op) => op.status === "accepted")
    .map((op) => ({ op, seq: readOpResult(op)?.seq ?? -1 }))
    .sort((a, b) => b.seq - a.seq);
  const conflicts: string[] = [];
  for (const { op } of accepted) {
    let undone = false;
    try {
      undone = undoBundleOp(tx, ctx, op);
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
    }
    if (!undone) conflicts.push(op.label);
  }
  if (conflicts.length > 0) {
    throw new ActionError(
      "CONFLICT",
      `These can't be undone because the story changed after they were accepted: ${quoteOpLabels(conflicts)}.`,
    );
  }
  touchStudioStory(tx, row.storyId, now);
  return {
    bundle: saveBundle(tx, row, row.operations, "undone", now),
    workspacePatch: diffStoryRows(before, captureStoryRows(tx, row.storyId)),
  };
}

/**
 * Accepts (all, or `opIds`), rejects, or undoes a bundle. Run it inside one
 * transaction: accept checks every baseline before writing and applies the
 * selection atomically. Each decision is idempotent once its target state
 * is reached, returning the bundle and an empty patch.
 */
export function resolveStudioBundle(
  tx: LocalinkTx,
  input: {
    storyId: string;
    bundleId: string;
    decision: StudioBundleDecision;
    /** Accept only; null accepts every op. */
    opIds: string[] | null;
  },
): StudioBundleResolution {
  const row = tx
    .select()
    .from(studioBundles)
    .where(
      and(
        eq(studioBundles.id, input.bundleId),
        eq(studioBundles.storyId, input.storyId),
      ),
    )
    .get();
  if (!row) {
    throw new ActionError(
      "BAD_REQUEST",
      "These proposed changes could not be found.",
    );
  }
  switch (input.decision) {
    case "accept":
      return acceptBundle(tx, row, input.opIds);
    case "reject":
      return rejectBundle(tx, row);
    case "undo":
      return undoBundle(tx, row);
  }
}
