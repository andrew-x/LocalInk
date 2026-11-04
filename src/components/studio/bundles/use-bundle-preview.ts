"use client";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  isStudioBundleTempRef,
  resolveStudioBundleRef,
  type StudioBundleDto,
  type StudioBundleOpDto,
  storyPatchKeys,
} from "@/lib/studio/bundle-contract";
import type { StudioPlanKind } from "@/lib/studio/contracts";

export type StudioBundleOpDtoOf<K extends StudioBundleOpDto["kind"]> = Extract<
  StudioBundleOpDto,
  { kind: K }
>;

/** A pending plan.create op, shaped for rendering as a proposed outline line. */
export type ProposedPlanItem = {
  /** The bundle the op belongs to (op ids repeat across bundles). */
  bundleId: string;
  op: StudioBundleOpDtoOf<"plan.create">;
  opId: string;
  /** The op's temp id; proposed children name it as their parent. */
  tempId: string;
  label: string;
  kind: StudioPlanKind;
  title: string;
  whatHappens: string;
  /**
   * A saved plan item id (a temp ref whose create was accepted resolves to
   * the created item), the temp id of another still-pending create, or null
   * for a chapter.
   */
  parentRef: string | null;
  /** The sibling it follows, resolved the same way, or null to append. */
  afterRef: string | null;
};

export type BundlePreview = {
  /** The most recent bundle with pending ops; only its ops preview in place. */
  bundleId: string | null;
  /** Pending plan.update / plan.move / plan.delete ops by their saved item. */
  planOpsByItemId: Map<string, StudioBundleOpDto[]>;
  proposedPlanItems: ProposedPlanItem[];
  /** Pending entry.update / entry.delete ops by their saved entry. */
  entryOpsByEntryId: Map<string, StudioBundleOpDto[]>;
  proposedEntries: StudioBundleOpDtoOf<"entry.create">[];
  /**
   * Pending story.update ops whose patch touches voice, genre or
   * instructions; the Voice tab shows them. An op that also patches other
   * keys is here too, and its row in the conversation list stays.
   */
  voiceOps: StudioBundleOpDtoOf<"story.update">[];
  /**
   * Pending prose ops shown as the chat's scene draft, keyed by the saved
   * moment, or by a proposed beat's temp id when that beat sits in a saved
   * scene (the manuscript places it among the scene's beats).
   */
  proseOpsByMomentId: Map<string, StudioBundleOpDto>;
  /**
   * Pending ops with no place in the outline, Characters, or manuscript:
   * story settings, tracking records, prose for beats of a scene that is
   * itself still proposed, and plan edits with nothing left to show. They
   * show in the conversation panel only.
   */
  otherOps: StudioBundleOpDto[];
};

const EMPTY: BundlePreview = {
  bundleId: null,
  planOpsByItemId: new Map(),
  proposedPlanItems: [],
  entryOpsByEntryId: new Map(),
  proposedEntries: [],
  voiceOps: [],
  proseOpsByMomentId: new Map(),
  otherOps: [],
};

/** The plan.update patch keys accept still applies (tension is ignored). */
const PLAN_UPDATE_KEYS = [
  "title",
  "whatHappens",
  "howToWrite",
  "craft",
  "presentEntryIds",
] as const satisfies readonly (keyof StudioBundleOpDtoOf<"plan.update">["patch"])[];

/** The story.update keys the Voice tab shows in place. */
const VOICE_STORY_KEYS: ReadonlySet<string> = new Set([
  "voice",
  "genre",
  "instructions",
]);

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The most recent bundle (by creation) that still has pending ops. */
export function latestPendingBundle(
  bundles: StudioBundleDto[],
): StudioBundleDto | null {
  let latest: StudioBundleDto | null = null;
  for (const bundle of bundles) {
    if (!bundle.operations.some((op) => op.status === "pending")) continue;
    if (
      !latest ||
      bundle.createdAt > latest.createdAt ||
      (bundle.createdAt === latest.createdAt && bundle.id > latest.id)
    ) {
      latest = bundle;
    }
  }
  return latest;
}

/**
 * Where each pending op of the latest pending bundle shows. Temp refs
 * resolve through creates already accepted (their `createdId`), so a beat
 * proposed under a scene the author accepted a moment ago lands in that
 * scene.
 */
export function buildBundlePreview(bundles: StudioBundleDto[]): BundlePreview {
  const bundle = latestPendingBundle(bundles);
  if (!bundle) return EMPTY;
  const { operations } = bundle;
  const resolve = (ref: string | null) =>
    ref === null ? null : (resolveStudioBundleRef(operations, ref) ?? ref);

  const preview: BundlePreview = {
    bundleId: bundle.id,
    planOpsByItemId: new Map(),
    proposedPlanItems: [],
    entryOpsByEntryId: new Map(),
    proposedEntries: [],
    voiceOps: [],
    proseOpsByMomentId: new Map(),
    otherOps: [],
  };
  const pendingCreates = new Map<string, StudioBundleOpDtoOf<"plan.create">>();
  for (const op of operations) {
    if (op.status === "pending" && op.kind === "plan.create") {
      pendingCreates.set(op.tempId, op);
    }
  }

  for (const op of operations) {
    if (op.status !== "pending") continue;
    switch (op.kind) {
      case "plan.create":
        preview.proposedPlanItems.push({
          bundleId: bundle.id,
          op,
          opId: op.id,
          tempId: op.tempId,
          label: op.label,
          kind: op.item.kind,
          title: op.item.title,
          whatHappens: op.item.whatHappens,
          parentRef: resolve(op.item.parentRef),
          afterRef: resolve(op.item.afterRef),
        });
        break;
      case "plan.update":
        // A legacy op whose patch held only `tension` has nothing to show
        // or apply in place; the conversation list still offers it.
        if (PLAN_UPDATE_KEYS.some((key) => op.patch[key] !== undefined)) {
          push(preview.planOpsByItemId, op.itemId, op);
        } else {
          preview.otherOps.push(op);
        }
        break;
      case "plan.move":
      case "plan.delete":
        push(preview.planOpsByItemId, op.itemId, op);
        break;
      case "entry.create":
        preview.proposedEntries.push(op);
        break;
      case "entry.update":
      case "entry.delete":
        push(preview.entryOpsByEntryId, op.entryId, op);
        break;
      case "story.update":
        if (storyPatchKeys(op.patch).some((key) => VOICE_STORY_KEYS.has(key))) {
          preview.voiceOps.push(op);
        } else {
          preview.otherOps.push(op);
        }
        break;
      case "prose.write": {
        const momentId = resolve(op.momentRef);
        if (momentId && !isStudioBundleTempRef(momentId)) {
          preview.proseOpsByMomentId.set(momentId, op);
          break;
        }
        // A proposed beat: placed in the manuscript only when its scene is
        // saved, since the manuscript lays out saved scenes.
        const beat = momentId ? pendingCreates.get(momentId) : undefined;
        const sceneId = beat ? resolve(beat.item.parentRef) : null;
        if (beat && sceneId && !isStudioBundleTempRef(sceneId)) {
          preview.proseOpsByMomentId.set(beat.tempId, op);
        } else {
          preview.otherOps.push(op);
        }
        break;
      }
      default:
        preview.otherOps.push(op);
    }
  }
  return preview;
}

// One preview per bundles array: every outline line, entry and manuscript
// block reads it, and the store replaces the array whenever a bundle changes.
const previewCache = new WeakMap<StudioBundleDto[], BundlePreview>();

/** `buildBundlePreview`, computed once per store bundles array. */
export function getBundlePreview(bundles: StudioBundleDto[]): BundlePreview {
  let preview = previewCache.get(bundles);
  if (!preview) {
    preview = buildBundlePreview(bundles);
    previewCache.set(bundles, preview);
  }
  return preview;
}

/** Derived from the most recent bundle with pending ops, pending ops only. */
export function useBundlePreview(): BundlePreview {
  const { state } = useStudioStore();
  return getBundlePreview(state.bundles);
}
