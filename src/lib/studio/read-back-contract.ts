import { z } from "zod";

import { studioAspectSchema } from "@/lib/studio/contracts";

const id = z.string().trim().min(1).max(128);

export const studioReadBackRequestSchema = z.object({
  storyId: id,
  momentId: id,
  force: z.boolean(),
});

export type StudioReadBackRequest = z.infer<typeof studioReadBackRequestSchema>;

/**
 * Model output. Sent to the provider in strict JSON-schema mode, so every
 * property is required and nothing is bounded here. The summary is asked to
 * stay within 80 words in the prompt and is accepted as returned; id lists are
 * validated after parsing by `normalizeStudioReadBack`.
 */
export const studioReadBackOutputSchema = z.object({
  summary: z.string(),
  whatHappens: z.string(),
  presentEntryIds: z.array(z.string()),
  matchedChangeIds: z.array(z.string()),
  missingChangeIds: z.array(z.string()),
  unplannedChanges: z.array(
    z.object({
      entryId: z.string(),
      aspect: studioAspectSchema,
      aboutEntryId: z.string().nullable(),
      value: z.string(),
    }),
  ),
});

export type StudioReadBackOutput = z.infer<typeof studioReadBackOutputSchema>;

export type StudioReadBackPreview = { generationId: string; skipped: boolean };

export type StagedStudioReadBack = {
  output: StudioReadBackOutput;
  sourceHash: string;
  sentenceHashes: string[];
};

/**
 * Drops every id outside the sets the prompt offered. `matchedChangeIds` may
 * name any offered record; `missingChangeIds` only records pinned to the
 * moment itself, and never one also reported as matched.
 */
export function normalizeStudioReadBack(
  raw: StudioReadBackOutput,
  allowed: {
    entryIds: Set<string>;
    matchableChangeIds: Set<string>;
    momentChangeIds: Set<string>;
  },
): StudioReadBackOutput {
  const unique = (ids: string[], valid: Set<string>) => [
    ...new Set(ids.filter((value) => valid.has(value))),
  ];
  const matchedChangeIds = unique(
    raw.matchedChangeIds,
    allowed.matchableChangeIds,
  );
  const matched = new Set(matchedChangeIds);
  const missingChangeIds = unique(
    raw.missingChangeIds,
    allowed.momentChangeIds,
  ).filter((changeId) => !matched.has(changeId));

  const seen = new Set<string>();
  const unplannedChanges = raw.unplannedChanges.flatMap((change) => {
    const value = change.value.trim();
    const aboutEntryId = change.aboutEntryId?.trim() || null;
    if (!value || !allowed.entryIds.has(change.entryId)) return [];
    if (aboutEntryId !== null && !allowed.entryIds.has(aboutEntryId)) return [];
    const key = JSON.stringify([
      change.entryId,
      change.aspect,
      aboutEntryId,
      value.toLowerCase(),
    ]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      { entryId: change.entryId, aspect: change.aspect, aboutEntryId, value },
    ];
  });

  return {
    summary: raw.summary.trim(),
    whatHappens: raw.whatHappens.trim(),
    presentEntryIds: unique(raw.presentEntryIds, allowed.entryIds),
    matchedChangeIds,
    missingChangeIds,
    unplannedChanges,
  };
}
