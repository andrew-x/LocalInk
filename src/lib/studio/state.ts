import { STUDIO_ASPECTS } from "@/lib/studio/bible-templates";
import type {
  StudioAspect,
  StudioChangeDto,
  StudioEntryDto,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { getPlanIndex } from "@/lib/studio/plan-order";

export type StudioEntryState = {
  entry: StudioEntryDto;
  aspects: {
    aspect: StudioAspect;
    aboutEntryId: string | null;
    values: { value: string; changeId: string; planItemId: string }[];
  }[];
};

export type StudioStateInput = {
  entries: StudioEntryDto[];
  changes: StudioChangeDto[];
  planItems: StudioPlanItemDto[];
};

const ACCUMULATING_ASPECTS = new Set<StudioAspect>(
  STUDIO_ASPECTS.filter((aspect) => aspect.accumulates).map(
    (aspect) => aspect.key,
  ),
);

/** Changes whose plan item exists, sorted into story replay order. */
function sortForReplay(
  changes: StudioChangeDto[],
  order: Map<string, { order: number }>,
): StudioChangeDto[] {
  return changes
    .filter((change) => order.has(change.planItemId))
    .sort((a, b) => {
      const orderA = order.get(a.planItemId)?.order ?? 0;
      const orderB = order.get(b.planItemId)?.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      if (a.position !== b.position) return a.position - b.position;
      if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * A change counts going into P when its item has fully ended before P starts:
 * not P, not an ancestor of P, and its last descendant precedes P in order.
 */
function changesGoingIn(
  input: StudioStateInput,
  pointItemId: string,
): StudioChangeDto[] {
  const index = getPlanIndex(input.planItems);
  const point = index.get(pointItemId);
  if (!point) return [];
  const eligible = input.changes.filter((change) => {
    const pinned = index.get(change.planItemId);
    return pinned !== undefined && pinned.endOrder < point.order;
  });
  return sortForReplay(eligible, index);
}

export function changesComingOut(
  input: StudioStateInput,
  pointItemId: string,
): StudioChangeDto[] {
  const index = getPlanIndex(input.planItems);
  const point = index.get(pointItemId);
  if (!point) return [];
  const own = input.changes.filter((change) => {
    const pinned = index.get(change.planItemId);
    return (
      pinned !== undefined &&
      pinned.order >= point.order &&
      pinned.order <= point.endOrder
    );
  });
  return sortForReplay(own, index);
}

function replay(
  entries: StudioEntryDto[],
  changes: StudioChangeDto[],
): Map<string, StudioEntryState> {
  const states = new Map<string, StudioEntryState>();
  for (const entry of entries) states.set(entry.id, { entry, aspects: [] });

  for (const change of changes) {
    const state = states.get(change.entryId);
    if (!state) continue;
    const aboutEntryId = change.aboutEntryId ?? null;
    const value = {
      value: change.value,
      changeId: change.id,
      planItemId: change.planItemId,
    };
    const existing = state.aspects.find(
      (item) =>
        item.aspect === change.aspect && item.aboutEntryId === aboutEntryId,
    );
    if (!existing) {
      state.aspects.push({
        aspect: change.aspect,
        aboutEntryId,
        values: [value],
      });
    } else if (ACCUMULATING_ASPECTS.has(change.aspect)) {
      existing.values.push(value);
    } else {
      existing.values = [value];
    }
  }
  return states;
}

export function computeStateGoingIn(
  input: StudioStateInput,
  pointItemId: string,
): Map<string, StudioEntryState> {
  return replay(input.entries, changesGoingIn(input, pointItemId));
}

/** State going in, then the point's own (and descendants') changes applied. */
export function computeStateComingOut(
  input: StudioStateInput,
  pointItemId: string,
): Map<string, StudioEntryState> {
  return replay(input.entries, [
    ...changesGoingIn(input, pointItemId),
    ...changesComingOut(input, pointItemId),
  ]);
}
