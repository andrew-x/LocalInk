import type { StudioPlanKind } from "./contracts";

/** Shown for a plan item with neither a title nor a description. */
export const PLAN_ITEM_PLACEHOLDER: Record<StudioPlanKind, string> = {
  chapter: "Empty chapter",
  scene: "Empty scene",
  moment: "Empty beat",
};

/**
 * What to call a plan item, since titles are optional: its title, else the
 * start of its description's first line, else a placeholder.
 */
export function planItemLabel(
  item: { kind: StudioPlanKind; title: string; whatHappens: string },
  maxLength = 60,
): string {
  const title = item.title.trim();
  if (title) return title;
  const firstLine =
    item.whatHappens
      .split("\n")
      .find((line) => line.trim())
      ?.replace(/\s+/g, " ")
      .trim() ?? "";
  if (!firstLine) return PLAN_ITEM_PLACEHOLDER[item.kind];
  return firstLine.length > maxLength
    ? `${firstLine.slice(0, maxLength).trimEnd()}…`
    : firstLine;
}
