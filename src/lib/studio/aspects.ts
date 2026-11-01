import type { StudioChangeDto, StudioChangeMode } from "@/lib/studio/contracts";

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
 * Distinct display labels an entry's changes already use, in first-use
 * order. The first spelling seen for a normalized label wins.
 */
export function entryAspectLabels(
  changes: StudioChangeDto[],
  entryId: string,
): string[] {
  const seen = new Map<string, string>();
  for (const change of changes) {
    if (change.entryId !== entryId) continue;
    const key = normalizeAspect(change.aspect);
    if (key && !seen.has(key)) seen.set(key, change.aspect.trim());
  }
  return [...seen.values()];
}

/** Mode of the most recent change (in array order) using this label. */
export function modeForLabel(
  changes: StudioChangeDto[],
  entryId: string,
  label: string,
): StudioChangeMode | null {
  const key = normalizeAspect(label);
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    if (change.entryId === entryId && normalizeAspect(change.aspect) === key) {
      return change.mode;
    }
  }
  return null;
}
