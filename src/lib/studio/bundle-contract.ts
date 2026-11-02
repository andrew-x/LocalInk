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
  studioStyleSchema,
} from "@/lib/studio/contracts";

/**
 * A change bundle is a set of operations proposed together (by chat now, by
 * cascade fixes later) that the author accepts in whole or in part, rejects,
 * or undoes. These schemas are action-side, not model-facing: bounds are
 * fine here, and the chat's tool schemas are separate.
 */

export type StudioBundleSource = "chat";
export type StudioBundleStatus =
  | "pending"
  | "accepted"
  | "partially-accepted"
  | "rejected"
  | "undone";
export type StudioBundleOpStatus = "pending" | "accepted" | "rejected";
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
    style: studioStyleSchema,
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
    style: studioStyleSchema,
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
export type StudioBundleChangeBaseline = z.infer<typeof changeBaselineSchema>;
export type StudioBundleChangePatch = z.infer<typeof changePatchSchema>;

/**
 * A stored op. `result` is recorded when the op is accepted: whatever undo
 * needs (created ids, previous values, delete snapshots). Server-only data;
 * DTOs drop it.
 */
export type StudioBundleOp = StudioBundleOpInput & {
  status: StudioBundleOpStatus;
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
 * entry/plan/change create was given (null otherwise).
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
 * - `conflict`: its baseline no longer matches, a record it names is gone,
 *   or (deletes) something inside what it deletes changed after proposal.
 * - `too-many-fields`: it would leave an entry above the field cap.
 * - `invalid`: it cannot apply as proposed (wrong nesting).
 */
export type StudioBundleIssueKind =
  | "missing-dependency"
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
   * True when the bundle was already in the target state (a retried
   * decision): nothing was written and the patch is empty, so reload the
   * workspace if the earlier response was lost.
   */
  replayed: boolean;
};

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
 * accepted create was given (null while pending, if that create was not
 * accepted, or once the bundle is undone, since DTOs of undone bundles carry
 * no created ids); a saved id is returned as is.
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
