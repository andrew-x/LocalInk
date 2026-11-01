import { STUDIO_ENTRY_SUGGESTIONS } from "@/lib/studio/bible-templates";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioEntryField,
  type StudioEntryType,
  type StudioFieldValue,
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

/** The one cleaning applied to every stored field label. */
export function cleanFieldLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

/** Short deterministic id suffix for keys too long to embed verbatim. */
function hashKey(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function legacyFieldId(key: string): string {
  const id = `studio-field-legacy-${key}`;
  return id.length <= 100
    ? id
    : `studio-field-legacy-${key.slice(0, 40)}-${hashKey(key)}`;
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
      id: legacyFieldId(key),
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
 * label take the new value and flags; new labels append until the list
 * holds `STUDIO_MAX_ENTRY_FIELDS` (an AI merge must never push an entry past
 * the cap, or the author could no longer edit it). Never removes. `skipped`
 * counts the distinct new labels the cap kept out.
 */
export function mergeAiFields(
  existing: StudioEntryField[],
  proposed: StudioProposedField[],
): { fields: StudioEntryField[]; skipped: number } {
  const merged = existing.map((field) => ({ ...field }));
  const skipped = new Set<string>();
  for (const item of proposed) {
    const label = cleanFieldLabel(item.label);
    const value = item.value.trim();
    if (!label || !value) continue;
    const normalized = normalizeFieldLabel(label);
    const index = merged.findIndex(
      (field) => normalizeFieldLabel(field.label) === normalized,
    );
    if (index === -1) {
      if (merged.length >= STUDIO_MAX_ENTRY_FIELDS) {
        skipped.add(normalized);
        continue;
      }
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
  return { fields: merged, skipped: skipped.size };
}

/** One edit to an entry's field list, addressed by label. */
export type StudioFieldOp =
  | {
      op: "set";
      label: string;
      value: string;
      steerOnly: boolean;
      backstoryOnly: boolean;
    }
  | { op: "remove"; label: string };

/**
 * Applies label-addressed field edits (an accepted bundle). A `set` on a
 * label the entry already has (first match by normalized label) replaces its
 * value and flags but keeps its id, spelling, and author: accepting is the
 * author's approval, so an author field stays author-written. A new label
 * appends as an AI field. A `remove` drops the first match; a missing label
 * is a no-op.
 */
export function applyFieldOps(
  fields: StudioEntryField[],
  ops: StudioFieldOp[],
): StudioEntryField[] {
  const next = fields.map((field) => ({ ...field }));
  for (const item of ops) {
    const label = cleanFieldLabel(item.label);
    if (!label) continue;
    const normalized = normalizeFieldLabel(label);
    const index = next.findIndex(
      (field) => normalizeFieldLabel(field.label) === normalized,
    );
    if (item.op === "remove") {
      if (index !== -1) next.splice(index, 1);
      continue;
    }
    if (index === -1) {
      next.push({
        id: generateId("studio-field"),
        label,
        value: item.value,
        author: "ai",
        steerOnly: item.steerOnly,
        backstoryOnly: item.backstoryOnly,
      });
      continue;
    }
    next[index] = {
      ...next[index],
      value: item.value,
      steerOnly: item.steerOnly,
      backstoryOnly: item.backstoryOnly,
    };
  }
  return next;
}
