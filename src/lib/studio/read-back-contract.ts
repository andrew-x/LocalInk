import { z } from "zod";

import {
  aspectIdentityKey,
  cleanAspectLabel,
  exactAspectKey,
} from "@/lib/studio/aspects";
import {
  type StudioAspect,
  type StudioChangeMode,
  type StudioFlagPayload,
  type StudioFlagStatus,
  studioChangeModeSchema,
} from "@/lib/studio/contracts";

const id = z.string().trim().min(1).max(128);

/** Read-back fills a moment title only when it is blank or this default. */
export const STUDIO_DEFAULT_MOMENT_TITLE = "Untitled moment";
const MAX_TITLE_CHARS = 200;
const MAX_NEW_ENTRIES = 3;
const MAX_NEW_ENTRY_DESCRIPTION_CHARS = 200;

/**
 * The key a name is compared by: lowercased, trimmed, whitespace collapsed.
 * The same folding read-back uses when it matches entry names in prose.
 */
export function studioNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

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
      aspect: z.string(),
      mode: studioChangeModeSchema,
      aboutEntryId: z.string().nullable(),
      value: z.string(),
    }),
  ),
  newEntries: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["character", "place"]),
      description: z.string(),
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
    /** `studioNameKey` of every entry name and every suggestion, any status. */
    knownNameKeys: Set<string>;
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
    const aspect = cleanAspectLabel(change.aspect);
    const aboutEntryId = change.aboutEntryId?.trim() || null;
    if (!value || !aspect || !allowed.entryIds.has(change.entryId)) return [];
    if (aboutEntryId !== null && !allowed.entryIds.has(aboutEntryId)) return [];
    const key = exactAspectKey({
      entryId: change.entryId,
      aspect,
      mode: change.mode,
      aboutEntryId,
      value,
    });
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        entryId: change.entryId,
        aspect,
        mode: change.mode,
        aboutEntryId,
        value,
      },
    ];
  });

  const knownKeys = new Set(allowed.knownNameKeys);
  const newEntries: StudioReadBackOutput["newEntries"] = [];
  for (const candidate of raw.newEntries) {
    const name = candidate.name.trim().replace(/\s+/g, " ");
    const key = studioNameKey(name);
    if (!key || knownKeys.has(key)) continue;
    knownKeys.add(key);
    newEntries.push({
      name,
      type: candidate.type,
      description: candidate.description
        .trim()
        .slice(0, MAX_NEW_ENTRY_DESCRIPTION_CHARS)
        .trim(),
    });
    if (newEntries.length >= MAX_NEW_ENTRIES) break;
  }

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
    newEntries,
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

type FindingLike = {
  entryId: string;
  aspect: StudioAspect;
  mode: StudioChangeMode;
  aboutEntryId: string | null;
  value: string;
};

/** Same entry, aspect, about-entry, and (case- and space-insensitive) value. */
export function exactFindingKey(finding: FindingLike): string {
  return exactAspectKey(finding);
}

/**
 * What a settled finding covers. A `set` aspect has one end state per entry
 * and about-entry in a moment, so wording does not matter. An `add` aspect
 * holds many facts, so a settled one covers only its own fact.
 */
export function findingKey(finding: FindingLike): string {
  return aspectIdentityKey(finding);
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
  momentChanges: FindingLike[],
  momentId: string,
): StudioUnplannedFinding[] {
  const recorded = new Set(momentChanges.map(findingKey));
  return flags.flatMap((flag) => {
    const { payload } = flag;
    if (flag.planItemId !== momentId || payload.kind !== "unplanned-change") {
      return [];
    }
    if (flag.status === "dismissed") return [payload];
    if (flag.status === "resolved" && recorded.has(findingKey(payload))) {
      return [payload];
    }
    return [];
  });
}
