import type { StudioPlanItemDto, StudioProseDto } from "@/lib/studio/contracts";
import { getOrderedMoments, getPlanIndex } from "@/lib/studio/plan-order";

/**
 * The last beat with written prose at or before `itemId` in plan order, or
 * the last written beat overall when `itemId` is null (or no longer exists).
 * A scene or chapter counts through its last beat. Tracked state is read
 * "coming out of" this beat, so it only ever reflects what is on the page.
 */
export function lastKeptBeatAtOrBefore(
  planItems: StudioPlanItemDto[],
  proseByMomentId: Map<string, StudioProseDto>,
  itemId: string | null,
): string | null {
  const index = getPlanIndex(planItems);
  const limit = itemId === null ? undefined : index.get(itemId)?.endOrder;
  const moments = getOrderedMoments(planItems);
  for (let i = moments.length - 1; i >= 0; i--) {
    const moment = moments[i];
    if (limit !== undefined) {
      const order = index.get(moment.id)?.order;
      if (order === undefined || order > limit) continue;
    }
    if (proseByMomentId.get(moment.id)?.markdown.trim()) return moment.id;
  }
  return null;
}
