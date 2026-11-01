import { z } from "zod";

import {
  cleanFieldLabel,
  normalizeFieldLabel,
  type StudioProposedField,
} from "@/lib/studio/entry-fields";

const id = z.string().trim().min(1).max(128);

export const STUDIO_SUGGEST_FIELDS_MAX = 8;
const LABEL_MAX = 80;
const VALUE_MAX = 4000;
const WHY_MAX = 300;

export const studioSuggestFieldsRequestSchema = z.object({
  storyId: id,
  entryId: id,
});

/**
 * Model output. Strict-safe: every property required, no bounds. The limits
 * and de-duplication are applied by `normalizeStudioSuggestedFields`.
 */
export const studioSuggestFieldsOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      steerOnly: z.boolean(),
      backstoryOnly: z.boolean(),
      why: z.string(),
    }),
  ),
});

export type StudioSuggestedField = StudioProposedField & { why: string };

/** The staged result: what the action reads back by generationId. */
export type StagedStudioSuggestedFields = {
  suggestions: StudioSuggestedField[];
};

export type StudioSuggestFieldsPreview = {
  generationId: string;
  suggestions: StudioSuggestedField[];
};

/** Trims, clips, drops blanks and labels the entry already has, caps at 8. */
export function normalizeStudioSuggestedFields(
  raw: z.infer<typeof studioSuggestFieldsOutputSchema>,
  existingLabels: string[],
): StudioSuggestedField[] {
  const seen = new Set(existingLabels.map(normalizeFieldLabel));
  const result: StudioSuggestedField[] = [];
  for (const item of raw.suggestions) {
    const label = cleanFieldLabel(item.label).slice(0, LABEL_MAX).trim();
    const value = item.value.trim().slice(0, VALUE_MAX);
    if (!label || !value) continue;
    const normalized = normalizeFieldLabel(label);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push({
      label,
      value,
      steerOnly: item.steerOnly,
      backstoryOnly: item.backstoryOnly,
      why: item.why.trim().slice(0, WHY_MAX),
    });
    if (result.length >= STUDIO_SUGGEST_FIELDS_MAX) break;
  }
  return result;
}
