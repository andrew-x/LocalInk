import type {
  StudioAspect,
  StudioEntryDto,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { buildPlanTree } from "@/lib/studio/plan-order";

/** Chapter id to its 1-based number in story order. */
export function chapterNumbers(
  items: StudioPlanItemDto[],
): Map<string, number> {
  return new Map(buildPlanTree(items).map((node, i) => [node.id, i + 1]));
}

/** The number of the chapter containing `itemId` (or `itemId` itself). */
export function chapterNumberOf(
  items: StudioPlanItemDto[],
  numbers: Map<string, number>,
  itemId: string,
): number | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current = byId.get(itemId);
  while (current && !seen.has(current.id)) {
    const number = numbers.get(current.id);
    if (number !== undefined) return number;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

export function entryNameMap(entries: StudioEntryDto[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.id, entry.name]));
}

/** "June, Is at (about Mara): the snack bar". Labels render as stored. */
export function describeChange(
  change: {
    aspect: StudioAspect;
    aboutEntryId: string | null;
    entryId: string;
    value: string;
  },
  names: Map<string, string>,
): string {
  const who = names.get(change.entryId) ?? "Unknown entry";
  const about = change.aboutEntryId
    ? ` (about ${names.get(change.aboutEntryId) ?? "unknown entry"})`
    : "";
  return `${who}, ${change.aspect}${about}: ${change.value}`;
}
