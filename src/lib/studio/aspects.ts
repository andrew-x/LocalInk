import { STUDIO_ASPECT_SUGGESTIONS } from "@/lib/studio/bible-templates";
import type {
  StudioChangeDto,
  StudioChangeMode,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { getPlanIndex, sortChangesForReplay } from "@/lib/studio/plan-order";

export const STUDIO_MAX_ASPECT_CHARS = 60;

/** Identity form of an aspect label: trimmed, single-spaced, lowercase. */
export function normalizeAspect(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trim and clip a label for storage. Returns "" when nothing is left. */
export function cleanAspectLabel(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, STUDIO_MAX_ASPECT_CHARS)
    .trim();
}

/**
 * Legacy rule for rows and flags written before modes existed: the old
 * accumulating aspects add, everything else replaces.
 */
export function legacyAspectMode(aspect: string): StudioChangeMode {
  const key = normalizeAspect(aspect);
  return key === "knows" || key === "note" ? "add" : "set";
}

type AspectLike = {
  entryId: string;
  aspect: string;
  mode: StudioChangeMode;
  aboutEntryId: string | null;
  value: string;
};

/** Normalized value text, for comparing facts regardless of case and spacing. */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * What one change occupies. `set` has one end state per entry, aspect and
 * about-entry, so wording is ignored; `add` holds many facts, so the value
 * text is part of the identity.
 */
export function aspectIdentityKey(change: AspectLike): string {
  const base = [
    change.entryId,
    normalizeAspect(change.aspect),
    change.aboutEntryId ?? null,
  ];
  return JSON.stringify(
    change.mode === "add" ? [...base, normalizeValue(change.value)] : base,
  );
}

/** Same as the identity key but always including the value text. */
export function exactAspectKey(change: AspectLike): string {
  return JSON.stringify([
    change.entryId,
    normalizeAspect(change.aspect),
    change.aboutEntryId ?? null,
    normalizeValue(change.value),
  ]);
}

/**
 * Distinct display labels an entry's changes already use, in first-use story
 * order. The spelling shown is the latest one in story order, as state shows.
 */
export function entryAspectLabels(
  changes: StudioChangeDto[],
  entryId: string,
  planItems: StudioPlanItemDto[],
): string[] {
  const seen = new Map<string, string>();
  const mine = changes.filter((change) => change.entryId === entryId);
  for (const change of sortChangesForReplay(mine, getPlanIndex(planItems))) {
    const key = normalizeAspect(change.aspect);
    if (key) seen.set(key, change.aspect.trim());
  }
  return [...seen.values()];
}

/** Mode of the latest change (in story order) using this label, if any. */
export function modeForLabel(
  changes: StudioChangeDto[],
  entryId: string,
  label: string,
  planItems: StudioPlanItemDto[],
): StudioChangeMode | null {
  const key = normalizeAspect(label);
  const mine = changes.filter(
    (change) =>
      change.entryId === entryId && normalizeAspect(change.aspect) === key,
  );
  const ordered = sortChangesForReplay(mine, getPlanIndex(planItems));
  return ordered.length > 0 ? ordered[ordered.length - 1].mode : null;
}

/**
 * Suggestions not already covered by a label in use. A suggestion counts as
 * covered by its own label or by the legacy key it replaced ("Is at" by
 * `where`), so a story tracking `where` is not offered "Is at" as new.
 */
export function unusedAspectSuggestions(
  usedLabels: Iterable<string>,
): typeof STUDIO_ASPECT_SUGGESTIONS {
  const used = new Set([...usedLabels].map(normalizeAspect));
  return STUDIO_ASPECT_SUGGESTIONS.filter(
    (item) =>
      !used.has(normalizeAspect(item.label)) &&
      !(item.legacyKey && used.has(item.legacyKey)),
  );
}

/** Suggestion matching a typed label by its own words or its legacy key. */
export function suggestionForLabel(
  label: string,
): (typeof STUDIO_ASPECT_SUGGESTIONS)[number] | undefined {
  const key = normalizeAspect(label);
  return STUDIO_ASPECT_SUGGESTIONS.find(
    (item) => normalizeAspect(item.label) === key || item.legacyKey === key,
  );
}
