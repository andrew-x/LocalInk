import { z } from "zod";

import { STUDIO_ASPECTS } from "@/lib/studio/bible-templates";
import {
  type StudioAspect,
  type StudioFlagPayload,
  type StudioFlagStatus,
  studioAspectSchema,
} from "@/lib/studio/contracts";

const id = z.string().trim().min(1).max(128);

/** Read-back fills a moment title only when it is blank or this default. */
export const STUDIO_DEFAULT_MOMENT_TITLE = "Untitled moment";
const MAX_TITLE_CHARS = 200;

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
 * validated after parsing by `normalizeStudioReadBack`. `title` is an empty
 * string unless the prompt asked for one.
 */
export const studioReadBackOutputSchema = z.object({
  summary: z.string(),
  title: z.string(),
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
    /** False drops any title the model returned anyway. */
    wantsTitle: boolean;
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
    title: allowed.wantsTitle
      ? raw.title.trim().slice(0, MAX_TITLE_CHARS).trim()
      : "",
    whatHappens: raw.whatHappens.trim(),
    presentEntryIds: unique(raw.presentEntryIds, allowed.entryIds),
    matchedChangeIds,
    missingChangeIds,
    unplannedChanges,
  };
}

/** Whether read-back may give this moment a title. */
export function momentNeedsTitle(moment: {
  title: string;
  authorFields: string[];
}): boolean {
  const title = moment.title.trim();
  return (
    !moment.authorFields.includes("title") &&
    (title === "" || title === STUDIO_DEFAULT_MOMENT_TITLE)
  );
}

export type StudioUnplannedFinding = Extract<
  StudioFlagPayload,
  { kind: "unplanned-change" }
>;

const ACCUMULATING_ASPECTS = new Set<StudioAspect>(
  STUDIO_ASPECTS.filter((aspect) => aspect.accumulates).map(
    (aspect) => aspect.key,
  ),
);

type FindingLike = {
  entryId: string;
  aspect: StudioAspect;
  aboutEntryId: string | null;
  value: string;
};

/** Same entry, aspect, about-entry, and (case- and space-insensitive) value. */
export function exactFindingKey(finding: FindingLike): string {
  return JSON.stringify([
    finding.entryId,
    finding.aspect,
    finding.aboutEntryId ?? null,
    finding.value.trim().toLowerCase(),
  ]);
}

/**
 * What a settled finding covers. A latest-wins aspect (feels, wants, where…)
 * has one end state per entry and about-entry in a moment, so wording does not
 * matter. Accumulating aspects (knows, note) hold many facts, so a settled
 * one covers only its own fact.
 */
export function findingKey(finding: FindingLike): string {
  if (ACCUMULATING_ASPECTS.has(finding.aspect)) return exactFindingKey(finding);
  return JSON.stringify([
    finding.entryId,
    finding.aspect,
    finding.aboutEntryId ?? null,
  ]);
}

/**
 * Unplanned-change findings the author already settled on this moment:
 * dismissed ones, and resolved ones whose recorded change is still on the
 * moment. A flag a later read-back superseded is also "resolved" but has no
 * recorded change, so it does not count and the finding can be raised again.
 */
export function settledUnplannedFindings(
  flags: {
    planItemId: string;
    status: StudioFlagStatus;
    payload: StudioFlagPayload;
  }[],
  momentChanges: {
    entryId: string;
    aspect: StudioAspect;
    aboutEntryId: string | null;
  }[],
  momentId: string,
): StudioUnplannedFinding[] {
  const recorded = new Set(
    momentChanges.map((change) =>
      JSON.stringify([change.entryId, change.aspect, change.aboutEntryId]),
    ),
  );
  return flags.flatMap((flag) => {
    const { payload } = flag;
    if (flag.planItemId !== momentId || payload.kind !== "unplanned-change") {
      return [];
    }
    if (flag.status === "dismissed") return [payload];
    if (
      flag.status === "resolved" &&
      recorded.has(
        JSON.stringify([payload.entryId, payload.aspect, payload.aboutEntryId]),
      )
    ) {
      return [payload];
    }
    return [];
  });
}
