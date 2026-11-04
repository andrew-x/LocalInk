import { z } from "zod";

import {
  type StudioChangeDto,
  type StudioEntryDto,
  type StudioFlagDto,
  type StudioPlanItemDto,
  type StudioPlanKind,
  type StudioProseDto,
  type StudioStoryDto,
  studioAspectSchema,
  studioChangeModeSchema,
  studioVoiceSchema,
} from "@/lib/studio/contracts";

/**
 * A change bundle is a set of operations proposed together (by chat now, by
 * cascade fixes later). The author accepts or dismisses ops one at a time
 * (or all at once) while the bundle stays pending, and can undo everything
 * accepted so far. These schemas are action-side, not model-facing: bounds
 * are fine here, and the chat's tool schemas are separate.
 */

export type StudioBundleSource = "chat";
/** Derived from the op statuses by `bundleStatusOf` on every decision. */
export type StudioBundleStatus =
  | "pending"
  | "accepted"
  | "partially-accepted"
  | "rejected"
  | "undone";
export type StudioBundleOpStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "undone";
/**
 * Why a rejected op was dismissed: the author (✕, Dismiss all, a dismissed
 * create's dependents, an undo's dependents) or a new chat message, which
 * dismisses everything still pending without review.
 */
export type StudioBundleDismissal = "author" | "new-message";
export type StudioBundleDecision = "accept" | "reject" | "undo";

/**
 * Records an op creates are addressed by temp ids until accept assigns real
 * ones. Saved ids never contain ":", so a ref with this prefix is always a
 * temp id and must be declared by a create op in the same bundle.
 */
export const STUDIO_BUNDLE_TEMP_PREFIX = "new:";
export const STUDIO_BUNDLE_MAX_OPS = 300;

export function isStudioBundleTempRef(ref: string): boolean {
  return ref.startsWith(STUDIO_BUNDLE_TEMP_PREFIX);
}

const idSchema = z.string().trim().min(1).max(128);
/** A saved record's id, never a temp id. */
const savedIdSchema = idSchema.refine(
  (value) => !isStudioBundleTempRef(value),
  "Expected a saved id, not a temp id.",
);
/** A saved id, or the temp id of a create op in the same bundle. */
const refSchema = idSchema;
const tempIdSchema = z
  .string()
  .regex(/^new:[A-Za-z0-9_.-]{1,64}$/, "Temp ids look like new:<name>.");
const revisionSchema = z.number().int().min(0);
const fieldLabelSchema = z.string().trim().min(1).max(80);
const fieldValueSchema = z.string().max(20_000);
const changeValueSchema = z.string().trim().min(1).max(4000);
const craftSchema = z.record(z.string().max(60), z.string().max(2000));
const refListSchema = z.array(refSchema).max(100);

const opBase = {
  id: idSchema,
  /** Short user-facing description; conflict messages name ops by it. */
  label: z.string().trim().min(1).max(200),
};

const storyPatchSchema = z
  .object({
    overview: z.string().max(20_000),
    instructions: z.string().max(8000),
    genre: z.array(z.string().max(40)).max(4),
    voice: studioVoiceSchema,
    theme: z.string().max(2000),
    structureTemplate: z.enum([
      "romance",
      "coming-of-age",
      "quiet",
      "freeform",
    ]),
    structureNotes: z.string().max(8000),
  })
  .partial();

const storyBaselineSchema = z
  .object({
    overview: z.string(),
    instructions: z.string(),
    genre: z.array(z.string()),
    voice: studioVoiceSchema,
    theme: z.string(),
    structureTemplate: z.enum([
      "romance",
      "coming-of-age",
      "quiet",
      "freeform",
    ]),
    structureNotes: z.string(),
  })
  .partial();

const newFieldSchema = z.object({
  label: fieldLabelSchema,
  value: fieldValueSchema,
  steerOnly: z.boolean(),
  backstoryOnly: z.boolean(),
});

const fieldOpSchema = z.discriminatedUnion("op", [
  newFieldSchema.extend({ op: z.literal("set") }),
  z.object({ op: z.literal("remove"), label: fieldLabelSchema }),
]);

/** Change-record values as stored when the op was proposed. */
const changeBaselineSchema = z.object({
  aspect: z.string(),
  mode: studioChangeModeSchema,
  value: z.string(),
  aboutEntryId: idSchema.nullable(),
  planItemId: idSchema,
});

const changePatchSchema = z
  .object({
    aspect: studioAspectSchema,
    mode: studioChangeModeSchema,
    value: changeValueSchema,
    aboutEntryId: refSchema.nullable(),
    planItemId: refSchema,
  })
  .partial();

export const studioBundleOpInputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...opBase,
    kind: z.literal("story.update"),
    patch: storyPatchSchema,
    /** Current values of the patched keys when proposed. */
    baseline: storyBaselineSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("entry.create"),
    tempId: tempIdSchema,
    entry: z.object({
      type: z.enum([
        "character",
        "relationship",
        "place",
        "thing",
        "lore",
        "custom",
      ]),
      customTypeLabel: z.string().trim().max(60),
      name: z.string().trim().min(1).max(200),
      summary: z.string().max(20_000),
      fields: z.array(newFieldSchema).max(100),
      relatedEntryRefs: refListSchema,
    }),
  }),
  z.object({
    ...opBase,
    kind: z.literal("entry.update"),
    entryId: savedIdSchema,
    baselineRevision: revisionSchema,
    patch: z.object({
      name: z.string().trim().min(1).max(200).optional(),
      summary: z.string().max(20_000).optional(),
      fieldOps: z.array(fieldOpSchema).max(100),
    }),
  }),
  z.object({
    ...opBase,
    kind: z.literal("entry.delete"),
    entryId: savedIdSchema,
    baselineRevision: revisionSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("plan.create"),
    tempId: tempIdSchema,
    item: z.object({
      kind: z.enum(["chapter", "scene", "moment"]),
      parentRef: refSchema.nullable(),
      /** Sibling to insert after; null appends at the end. */
      afterRef: refSchema.nullable(),
      title: z.string().max(200),
      whatHappens: z.string().max(20_000),
      howToWrite: z.string().max(20_000),
      craft: craftSchema,
      presentEntryRefs: refListSchema,
    }),
  }),
  z.object({
    ...opBase,
    kind: z.literal("plan.update"),
    itemId: savedIdSchema,
    baselineRevision: revisionSchema,
    patch: z
      .object({
        title: z.string().max(200),
        whatHappens: z.string().max(20_000),
        howToWrite: z.string().max(20_000),
        craft: craftSchema,
        /** Saved ids or temp ids of entries created in the same bundle. */
        presentEntryIds: refListSchema,
      })
      .partial(),
  }),
  z.object({
    ...opBase,
    kind: z.literal("plan.move"),
    itemId: savedIdSchema,
    baselineRevision: revisionSchema,
    /** Where the item sat when proposed (moves do not bump revisions). */
    baselineParentId: idSchema.nullable(),
    /** The item's stored `position` when proposed. */
    baselinePosition: z.number().int().min(0),
    newParentRef: refSchema.nullable(),
    /** Index among the new parent's other children when the move runs. */
    newIndex: z.number().int().min(0),
  }),
  z.object({
    ...opBase,
    kind: z.literal("plan.delete"),
    itemId: savedIdSchema,
    baselineRevision: revisionSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("change.create"),
    entryRef: refSchema,
    aspect: studioAspectSchema,
    mode: studioChangeModeSchema,
    aboutEntryRef: refSchema.nullable(),
    value: changeValueSchema,
    planItemRef: refSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("change.update"),
    changeId: savedIdSchema,
    baseline: changeBaselineSchema,
    /** `aboutEntryId` and `planItemId` may be temp ids. */
    patch: changePatchSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("change.delete"),
    changeId: savedIdSchema,
    baseline: changeBaselineSchema,
  }),
  z.object({
    ...opBase,
    kind: z.literal("prose.write"),
    momentRef: refSchema,
    /** 0 means the moment had no prose row. */
    baselineRevision: revisionSchema,
    /** `hashText` of the prose when proposed; "" skips the hash check. */
    baselineHash: z.string().max(64),
    markdown: z.string().max(200_000),
  }),
]);

export const studioBundleOpsInputSchema = z
  .array(studioBundleOpInputSchema)
  .min(1)
  .max(STUDIO_BUNDLE_MAX_OPS);

/** An op as proposed, before it is stored. */
export type StudioBundleOpInput = z.infer<typeof studioBundleOpInputSchema>;
export type StudioBundleOpKind = StudioBundleOpInput["kind"];
export type StudioBundleStoryPatch = z.infer<typeof storyPatchSchema>;

/**
 * The keys of a stored story patch that still mean something. Pending ops
 * proposed before the voice redesign may carry a `style` key; stored ops are
 * not re-parsed, so readers use this to treat such keys as absent.
 */
export function storyPatchKeys(
  patch: StudioBundleStoryPatch,
): (keyof StudioBundleStoryPatch)[] {
  const known = new Set<string>(Object.keys(storyPatchSchema.shape));
  return Object.keys(patch).filter((key) =>
    known.has(key),
  ) as (keyof StudioBundleStoryPatch)[];
}
export type StudioBundleChangeBaseline = z.infer<typeof changeBaselineSchema>;
export type StudioBundleChangePatch = z.infer<typeof changePatchSchema>;

/**
 * A stored op. `result` is recorded when the op is accepted: whatever undo
 * needs (created ids, previous values, delete snapshots). Server-only data;
 * DTOs drop it. `baselineAt` and `dismissedBy` are action-side bookkeeping,
 * never model-facing.
 */
export type StudioBundleOp = StudioBundleOpInput & {
  status: StudioBundleOpStatus;
  /**
   * When an accept or undo of other ops in this bundle last rewrote this
   * op's baselines. Delete checks count writes after it as conflicts
   * (after the bundle's createdAt when unset).
   */
  baselineAt?: string;
  /** Set on rejected ops. */
  dismissedBy?: StudioBundleDismissal;
  /**
   * When it was rejected. For a new-message dismissal this is the sending
   * turn's prepare, so chat history can tell whether a reply has followed.
   */
  dismissedAt?: string;
  result?: unknown;
};

export type StudioBundleOpOf<K extends StudioBundleOpKind> = Extract<
  StudioBundleOp,
  { kind: K }
>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/**
 * An op as the client sees it. `createdId` is the real id an accepted
 * entry/plan/change create was given (null otherwise, including once the
 * op is undone).
 */
export type StudioBundleOpDto = DistributiveOmit<StudioBundleOp, "result"> & {
  createdId: string | null;
};

export type StudioBundleDto = {
  id: string;
  storyId: string;
  source: StudioBundleSource;
  threadId: string | null;
  messageId: string | null;
  generationId: string;
  summary: string;
  operations: StudioBundleOpDto[];
  status: StudioBundleStatus;
  createdAt: string;
  updatedAt: string;
};

/**
 * What changed in the workspace. Merge the lists by id and drop the removed
 * ids; changes, prose, and flags of a removed plan item go with it.
 */
export type StudioBundleWorkspacePatch = {
  story?: StudioStoryDto;
  entries: StudioEntryDto[];
  planItems: StudioPlanItemDto[];
  changes: StudioChangeDto[];
  prose: StudioProseDto[];
  flags: StudioFlagDto[];
  removed: { planItemIds: string[]; entryIds: string[]; changeIds: string[] };
};

/**
 * Why a selected op cannot be accepted:
 * - `missing-dependency`: it needs a temp id only unselected ops create.
 *   Accept pulls pending creates in automatically, so only a caller that
 *   checks an unexpanded selection (the chat builder) sees it.
 * - `dependency-dismissed`: a create it needs was dismissed or undone.
 * - `dismissed`: it was itself dismissed or undone already, so accept
 *   refuses it.
 * - `conflict`: its baseline no longer matches, a record it names is gone,
 *   or (deletes) something inside what it deletes changed after proposal.
 * - `too-many-fields`: it would leave an entry above the field cap.
 * - `invalid`: it cannot apply as proposed (wrong nesting).
 */
export type StudioBundleIssueKind =
  | "missing-dependency"
  | "dependency-dismissed"
  | "dismissed"
  | "conflict"
  | "too-many-fields"
  | "invalid";

/** One problem with one op; an op can have more than one. */
export type StudioBundleSelectionIssue =
  | {
      opId: string;
      label: string;
      kind: "missing-dependency";
      /** The unselected ops it needs. */
      needsOpIds: string[];
    }
  | {
      opId: string;
      label: string;
      kind: Exclude<StudioBundleIssueKind, "missing-dependency">;
    };

/** Every problem with a selection at once; empty means it can be accepted. */
export type StudioBundleSelectionCheck = {
  issues: StudioBundleSelectionIssue[];
};

export type StudioBundleResolution = {
  bundle: StudioBundleDto;
  workspacePatch: StudioBundleWorkspacePatch;
  /**
   * True when the requested ops were already in the target state (a retried
   * decision): nothing was written and the patch is empty, so reload the
   * workspace if the earlier response was lost.
   */
  replayed: boolean;
};

type StatusedOp = StudioBundleOpInput & { status: StudioBundleOpStatus };

/**
 * The bundle status the op statuses add up to: pending while any op is;
 * accepted when every decided op was; partly accepted when some were;
 * undone when some were undone and none is accepted; otherwise rejected.
 */
export function bundleStatusOf(
  ops: readonly { status: StudioBundleOpStatus }[],
): StudioBundleStatus {
  if (ops.some((op) => op.status === "pending")) return "pending";
  if (ops.every((op) => op.status === "accepted")) return "accepted";
  if (ops.some((op) => op.status === "accepted")) return "partially-accepted";
  if (ops.some((op) => op.status === "undone")) return "undone";
  return "rejected";
}

/** The temp id an op declares, and what kind of record it creates. */
export function studioBundleOpCreates(
  op: StudioBundleOpInput,
): { tempId: string; target: "entry" | "plan" } | null {
  if (op.kind === "entry.create") return { tempId: op.tempId, target: "entry" };
  if (op.kind === "plan.create") return { tempId: op.tempId, target: "plan" };
  return null;
}

/**
 * The record a ref names after accept: a temp id maps to the real id its
 * accepted create was given (null while pending, if that create was
 * dismissed, or once it is undone, since DTOs of undone ops carry no
 * created ids); a saved id is returned as is.
 */
export function resolveStudioBundleRef(
  operations: StudioBundleOpDto[],
  ref: string,
): string | null {
  if (!isStudioBundleTempRef(ref)) return ref;
  const creator = operations.find(
    (op) => studioBundleOpCreates(op)?.tempId === ref,
  );
  return creator?.createdId ?? null;
}

/**
 * Other records an op points at (saved or temp ids), split by table. The
 * op's own target (`entryId`, `itemId`, `changeId`) is not included.
 */
export function studioBundleOpRefs(op: StudioBundleOpInput): {
  entryRefs: string[];
  planRefs: string[];
} {
  switch (op.kind) {
    case "entry.create":
      return { entryRefs: op.entry.relatedEntryRefs, planRefs: [] };
    case "plan.create":
      return {
        entryRefs: op.item.presentEntryRefs,
        planRefs: [op.item.parentRef, op.item.afterRef].filter(
          (ref): ref is string => ref !== null,
        ),
      };
    case "plan.update":
      return { entryRefs: op.patch.presentEntryIds ?? [], planRefs: [] };
    case "plan.move":
      return {
        entryRefs: [],
        planRefs: op.newParentRef === null ? [] : [op.newParentRef],
      };
    case "change.create":
      return {
        entryRefs: [op.entryRef, op.aboutEntryRef].filter(
          (ref): ref is string => ref !== null,
        ),
        planRefs: [op.planItemRef],
      };
    case "change.update":
      return {
        entryRefs: op.patch.aboutEntryId ? [op.patch.aboutEntryId] : [],
        planRefs: op.patch.planItemId ? [op.patch.planItemId] : [],
      };
    case "prose.write":
      return { entryRefs: [], planRefs: [op.momentRef] };
    default:
      return { entryRefs: [], planRefs: [] };
  }
}

/**
 * Dependencies inside a bundle, by op id: the create ops whose temp ids the
 * op references. An op never depends on itself (a new entry may list itself
 * as related).
 */
export function studioBundleOpCreators<T extends StudioBundleOpInput>(
  ops: readonly T[],
): Map<string, T[]> {
  const byTempId = new Map<string, T>();
  for (const op of ops) {
    const created = studioBundleOpCreates(op);
    if (created) byTempId.set(created.tempId, op);
  }
  return new Map(
    ops.map((op) => {
      const { entryRefs, planRefs } = studioBundleOpRefs(op);
      const creators = new Set<T>();
      for (const ref of [...entryRefs, ...planRefs]) {
        const creator = isStudioBundleTempRef(ref)
          ? byTempId.get(ref)
          : undefined;
        if (creator && creator.id !== op.id) creators.add(creator);
      }
      return [op.id, [...creators]];
    }),
  );
}

/**
 * What accepting `opIds` applies: the ones still pending plus, transitively,
 * the pending creates they reference, so a new beat brings its new scene.
 * Accept and the selection check both use it, so they cannot drift.
 */
export function expandStudioBundleAccept(
  ops: readonly StatusedOp[],
  opIds: Iterable<string>,
): Set<string> {
  const creatorsOf = studioBundleOpCreators(ops);
  const byId = new Map(ops.map((op) => [op.id, op]));
  const selected = new Set<string>();
  const queue = [...opIds].flatMap((id) => byId.get(id) ?? []);
  while (queue.length > 0) {
    const op = queue.pop() as StatusedOp;
    if (op.status !== "pending" || selected.has(op.id)) continue;
    selected.add(op.id);
    queue.push(...(creatorsOf.get(op.id) ?? []));
  }
  return selected;
}

/**
 * The pending ops that depend on any of `opIds` (creates), transitively
 * through other pending ops; `opIds` themselves are left out. Dismissing or
 * undoing a create takes these with it, since they could never apply.
 */
export function studioBundlePendingDependents(
  ops: readonly StatusedOp[],
  opIds: Iterable<string>,
): Set<string> {
  const creatorsOf = studioBundleOpCreators(ops);
  const dependents = new Map<string, StatusedOp[]>();
  for (const op of ops) {
    for (const creator of creatorsOf.get(op.id) ?? []) {
      dependents.set(creator.id, [...(dependents.get(creator.id) ?? []), op]);
    }
  }
  const roots = new Set(opIds);
  const found = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const dependent of dependents.get(id) ?? []) {
      if (
        dependent.status !== "pending" ||
        roots.has(dependent.id) ||
        found.has(dependent.id)
      ) {
        continue;
      }
      found.add(dependent.id);
      queue.push(dependent.id);
    }
  }
  return found;
}

/** The parent kind a plan item of this kind lives under (null: the root). */
export function studioPlanParentKind(
  kind: StudioPlanKind,
): StudioPlanKind | null {
  if (kind === "chapter") return null;
  return kind === "scene" ? "chapter" : "scene";
}

const quote = (label: string) => `“${label}”`;

/**
 * Checks a proposed bundle against itself: unique op and temp ids, temp
 * refs that name a create of the right kind, plan nesting, one prose write
 * per moment and one delete per record. Returns user-facing problems; empty
 * means valid. Saved ids are checked against the story at accept time.
 */
export function validateStudioBundleOps(ops: StudioBundleOpInput[]): string[] {
  const errors: string[] = [];
  const opIds = new Set<string>();
  const creators = new Map<string, StudioBundleOpInput>();
  for (const op of ops) {
    if (opIds.has(op.id)) errors.push(`${quote(op.label)} reuses an op id.`);
    opIds.add(op.id);
    const created = studioBundleOpCreates(op);
    if (!created) continue;
    if (creators.has(created.tempId)) {
      errors.push(`${quote(op.label)} reuses a temp id.`);
    }
    creators.set(created.tempId, op);
  }
  const planCreator = (ref: string | null) => {
    if (ref === null || !isStudioBundleTempRef(ref)) return undefined;
    const creator = creators.get(ref);
    return creator?.kind === "plan.create" ? creator : undefined;
  };

  const proseTargets = new Set<string>();
  const deleteTargets = new Set<string>();
  for (const op of ops) {
    const name = quote(op.label);
    const { entryRefs, planRefs } = studioBundleOpRefs(op);
    for (const ref of entryRefs) {
      if (!isStudioBundleTempRef(ref)) continue;
      if (creators.get(ref)?.kind !== "entry.create") {
        errors.push(`${name} refers to an entry no change creates.`);
      }
    }
    for (const ref of planRefs) {
      if (isStudioBundleTempRef(ref) && !planCreator(ref)) {
        errors.push(`${name} refers to a plan item no change creates.`);
      }
    }

    switch (op.kind) {
      case "story.update": {
        const keys = Object.keys(op.patch).sort();
        if (keys.length === 0) errors.push(`${name} changes nothing.`);
        if (keys.join() !== Object.keys(op.baseline).sort().join()) {
          errors.push(`${name} has no baseline for every setting it changes.`);
        }
        break;
      }
      case "entry.update":
        if (
          op.patch.name === undefined &&
          op.patch.summary === undefined &&
          op.patch.fieldOps.length === 0
        ) {
          errors.push(`${name} changes nothing.`);
        }
        break;
      case "plan.update":
      case "change.update":
        if (Object.keys(op.patch).length === 0) {
          errors.push(`${name} changes nothing.`);
        }
        break;
      case "plan.create": {
        const parentKind = studioPlanParentKind(op.item.kind);
        if ((parentKind === null) !== (op.item.parentRef === null)) {
          errors.push(
            parentKind
              ? `${name} needs a ${parentKind} to live in.`
              : `${name} is a chapter, so it cannot have a parent.`,
          );
        }
        const parent = planCreator(op.item.parentRef);
        if (parent?.kind === "plan.create" && parent.item.kind !== parentKind) {
          errors.push(`${name} is nested under the wrong kind of item.`);
        }
        const after = planCreator(op.item.afterRef);
        if (
          after?.kind === "plan.create" &&
          (after.item.parentRef !== op.item.parentRef ||
            after.item.kind !== op.item.kind)
        ) {
          errors.push(`${name} is placed after an item in a different list.`);
        }
        break;
      }
      case "prose.write": {
        const moment = planCreator(op.momentRef);
        if (moment?.kind === "plan.create") {
          if (moment.item.kind !== "moment") {
            errors.push(
              `${name} writes prose for something that is not a moment.`,
            );
          }
          if (op.baselineRevision !== 0) {
            errors.push(`${name} has a baseline for a moment that is new.`);
          }
        }
        if (proseTargets.has(op.momentRef)) {
          errors.push(`${name} writes a moment another change also writes.`);
        }
        proseTargets.add(op.momentRef);
        break;
      }
      case "entry.delete":
      case "plan.delete":
      case "change.delete": {
        const target =
          op.kind === "entry.delete"
            ? op.entryId
            : op.kind === "plan.delete"
              ? op.itemId
              : op.changeId;
        if (deleteTargets.has(target)) {
          errors.push(`${name} deletes something another change also deletes.`);
        }
        deleteTargets.add(target);
        break;
      }
      default:
        break;
    }
  }

  // "After" chains between new siblings must not loop.
  for (const op of ops) {
    if (op.kind !== "plan.create") continue;
    const seen = new Set<string>([op.tempId]);
    let next = planCreator(op.item.afterRef);
    while (next?.kind === "plan.create") {
      if (seen.has(next.tempId)) {
        errors.push(`${quote(op.label)} is placed in a loop of new items.`);
        break;
      }
      seen.add(next.tempId);
      next = planCreator(next.item.afterRef);
    }
  }
  return errors;
}
