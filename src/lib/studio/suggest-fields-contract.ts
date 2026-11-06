import { z } from "zod";

import type { StudioEntryDto, StudioEntryField } from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  normalizeFieldLabel,
  type StudioFieldRefreshOp,
} from "@/lib/studio/entry-fields";

const id = z.string().trim().min(1).max(128);

export const STUDIO_REFRESH_OPS_MAX = 12;
const LABEL_MAX = 80;
const VALUE_MAX = 4000;

export const studioRefreshFieldsRequestSchema = z.object({
  storyId: id,
  entryId: id,
});

/**
 * Model output. Strict-safe: every property required, no bounds. `fieldId` is
 * null for an add. The limits, ownership and de-duplication are applied by
 * `normalizeStudioRefreshedFields`.
 */
export const studioRefreshFieldsOutputSchema = z.object({
  ops: z.array(
    z.object({
      action: z.enum(["add", "update", "remove"]),
      fieldId: z.string().nullable(),
      label: z.string(),
      value: z.string(),
      steerOnly: z.boolean(),
      backstoryOnly: z.boolean(),
    }),
  ),
});

/** The staged result: what the action reads back by generationId. */
export type StagedStudioRefreshedFields = {
  ops: StudioFieldRefreshOp[];
  /** The entry's revision when the model read it; the apply compares against it. */
  sourceRevision: number;
};

export type StudioRefreshFieldsPreview = {
  generationId: string;
};

export type StudioRefreshedFieldsApplyResult = {
  /** The saved entry, or null when it changed after the refresh was made. */
  entry: StudioEntryDto | null;
  stale: boolean;
};

/**
 * Keeps only ops the AI may make: never on author-owned or unknown fields,
 * never with a blank value, one op per field, at most `maxOps`. An add whose label
 * matches an AI field becomes an update; one matching an author field drops.
 */
export function normalizeStudioRefreshedFields(
  raw: z.infer<typeof studioRefreshFieldsOutputSchema>,
  existing: StudioEntryField[],
  maxOps: number = STUDIO_REFRESH_OPS_MAX,
): StudioFieldRefreshOp[] {
  const aiById = new Map(
    existing.filter((field) => field.author === "ai").map((f) => [f.id, f]),
  );
  const byLabel = new Map(
    existing.map((field) => [normalizeFieldLabel(field.label), field]),
  );
  const touched = new Set<string>();
  const addedLabels = new Set<string>();
  const result: StudioFieldRefreshOp[] = [];

  for (const item of raw.ops) {
    if (result.length >= maxOps) break;
    const value = item.value.trim().slice(0, VALUE_MAX);

    if (item.action === "remove") {
      const target = item.fieldId ? aiById.get(item.fieldId) : undefined;
      if (!target || touched.has(target.id)) continue;
      touched.add(target.id);
      result.push({ action: "remove", fieldId: target.id });
      continue;
    }

    if (!value) continue;
    let target = item.fieldId ? aiById.get(item.fieldId) : undefined;
    if (item.action === "update" && !target) continue;

    if (item.action === "add") {
      const label = cleanFieldLabel(item.label).slice(0, LABEL_MAX).trim();
      if (!label) continue;
      const normalized = normalizeFieldLabel(label);
      const match = byLabel.get(normalized);
      if (match) {
        if (match.author === "author") continue;
        target = match;
      } else {
        if (addedLabels.has(normalized)) continue;
        addedLabels.add(normalized);
        result.push({
          action: "add",
          label,
          value,
          steerOnly: item.steerOnly,
          backstoryOnly: item.backstoryOnly,
        });
        continue;
      }
    }

    if (!target || touched.has(target.id)) continue;
    touched.add(target.id);
    result.push({
      action: "update",
      fieldId: target.id,
      value,
      steerOnly: item.steerOnly,
      backstoryOnly: item.backstoryOnly,
    });
  }
  return result;
}
