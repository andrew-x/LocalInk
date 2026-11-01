import { STUDIO_ENTRY_SUGGESTIONS } from "@/lib/studio/bible-templates";
import type {
  StudioEntryField,
  StudioEntryType,
  StudioFieldValue,
} from "@/lib/studio/contracts";
import { generateId } from "@/lib/util";

export type StudioProposedField = {
  label: string;
  value: string;
  steerOnly: boolean;
  backstoryOnly: boolean;
};

/** Labels match across entries and edits by this form. */
export function normalizeFieldLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function titleCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArrayShape(raw: unknown[]): StudioEntryField[] {
  const fields: StudioEntryField[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      typeof item.value !== "string"
    ) {
      continue;
    }
    fields.push({
      id: item.id,
      label: item.label,
      value: item.value,
      author: item.author === "author" ? "author" : "ai",
      steerOnly: item.steerOnly === true,
      backstoryOnly: item.backstoryOnly === true,
    });
  }
  return fields;
}

function parseLegacyShape(
  raw: Record<string, unknown>,
  type: StudioEntryType,
): StudioEntryField[] {
  const legacy = new Map<string, StudioFieldValue>();
  for (const [key, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || typeof entry.value !== "string") continue;
    if (!entry.value.trim()) continue;
    legacy.set(key, {
      value: entry.value,
      author: entry.author === "author" ? "author" : "ai",
    });
  }
  // Ids derive from the legacy key so they stay stable across reads until
  // the entry is rewritten in the new shape.
  const toField = (
    key: string,
    label: string,
    steerOnly: boolean,
    backstoryOnly: boolean,
  ): StudioEntryField => {
    const stored = legacy.get(key) as StudioFieldValue;
    return {
      id: `studio-field-legacy-${key}`,
      label,
      value: stored.value,
      author: stored.author,
      steerOnly,
      backstoryOnly,
    };
  };

  const fields: StudioEntryField[] = [];
  const seen = new Set<string>();
  for (const suggestion of STUDIO_ENTRY_SUGGESTIONS[type].suggestions) {
    const key = suggestion.legacyKey;
    if (!key || !legacy.has(key)) continue;
    seen.add(key);
    fields.push(
      toField(
        key,
        suggestion.label,
        suggestion.steerOnly,
        suggestion.backstoryOnly,
      ),
    );
  }
  for (const key of legacy.keys()) {
    if (seen.has(key)) continue;
    fields.push(toField(key, titleCaseKey(key) || key, false, false));
  }
  return fields;
}

/**
 * Reads stored entry fields in either shape. The legacy record drops empty
 * values; a new-shape array keeps them, since the author added them on
 * purpose.
 */
export function normalizeEntryFields(
  raw: unknown,
  type: StudioEntryType,
): StudioEntryField[] {
  if (Array.isArray(raw)) return parseArrayShape(raw);
  if (isRecord(raw)) return parseLegacyShape(raw, type);
  return [];
}

/**
 * Applies AI-proposed fields to an entry's list. Matches by normalized
 * label; author-written fields are never touched; AI fields with the same
 * label take the new value and flags; new labels append. Never removes.
 */
export function mergeAiFields(
  existing: StudioEntryField[],
  proposed: StudioProposedField[],
): StudioEntryField[] {
  const merged = existing.map((field) => ({ ...field }));
  for (const item of proposed) {
    const label = item.label.trim().replace(/\s+/g, " ");
    const value = item.value.trim();
    if (!label || !value) continue;
    const normalized = normalizeFieldLabel(label);
    const index = merged.findIndex(
      (field) => normalizeFieldLabel(field.label) === normalized,
    );
    if (index === -1) {
      merged.push({
        id: generateId("studio-field"),
        label,
        value,
        author: "ai",
        steerOnly: item.steerOnly,
        backstoryOnly: item.backstoryOnly,
      });
      continue;
    }
    if (merged[index].author === "author") continue;
    merged[index] = {
      ...merged[index],
      value,
      steerOnly: item.steerOnly,
      backstoryOnly: item.backstoryOnly,
    };
  }
  return merged;
}
