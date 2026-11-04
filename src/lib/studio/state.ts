import { normalizeAspect } from "@/lib/studio/aspects";
import type {
  StudioChangeDto,
  StudioChangeMode,
  StudioEntryDto,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { getPlanIndex, sortChangesForReplay } from "@/lib/studio/plan-order";

export type StudioEntryState = {
  entry: StudioEntryDto;
  aspects: {
    /** Display label: the most recent change's wording. */
    aspect: string;
    mode: StudioChangeMode;
    aboutEntryId: string | null;
    values: { value: string; changeId: string; planItemId: string }[];
  }[];
};

export type StudioStateInput = {
  entries: StudioEntryDto[];
  changes: StudioChangeDto[];
  planItems: StudioPlanItemDto[];
};

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
  return sortChangesForReplay(eligible, index);
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
  return sortChangesForReplay(own, index);
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
    const key = normalizeAspect(change.aspect);
    const existing = state.aspects.find(
      (item) =>
        normalizeAspect(item.aspect) === key &&
        item.aboutEntryId === aboutEntryId,
    );
    if (!existing) {
      state.aspects.push({
        aspect: change.aspect.trim(),
        mode: change.mode,
        aboutEntryId,
        values: [value],
      });
    } else {
      existing.aspect = change.aspect.trim();
      existing.mode = change.mode;
      if (change.mode === "add") existing.values.push(value);
      else existing.values = [value];
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
