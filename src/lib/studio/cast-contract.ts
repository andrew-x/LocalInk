import { z } from "zod";

import { ActionError } from "@/lib/action-error";
import type { StudioEntryDto } from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  normalizeFieldLabel,
  type StudioFieldRefreshOp,
  type StudioProposedField,
} from "@/lib/studio/entry-fields";
import { STUDIO_QUESTIONS_MAX } from "@/lib/studio/planning-contract";
import { studioRefreshFieldsOutputSchema } from "@/lib/studio/suggest-fields-contract";

const id = z.string().trim().min(1).max(128);

/**
 * The onboarding "People and places" step. Internally it is the cast, and a
 * cast member is a character or a place.
 */
export const STUDIO_CAST_TYPES = ["character", "place"] as const;
export type StudioCastType = (typeof STUDIO_CAST_TYPES)[number];
export const STUDIO_CAST_MAX_MEMBERS: Record<StudioCastType, number> = {
  character: 12,
  place: 10,
};
export const STUDIO_CAST_MAX_FIELDS = 20;
export const STUDIO_CAST_MAX_PICKS = 3;
export const STUDIO_CAST_REVISE_MAX_OPS = 24;
export const STUDIO_CAST_NUDGE_MAX_CHARS = 1000;
export const STUDIO_CAST_NOTE_MAX_CHARS = 2000;
const PICK_TEXT_MAX = 300;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const SUMMARY_MAX = 4000;
const LABEL_MAX = 80;
const VALUE_MAX = 4000;
const NAME_MAX = 200;

const answersSchema = z
  .array(
    z.object({
      questionId: id,
      question: z.string().max(1000),
      answer: z.string().max(4000),
    }),
  )
  .max(STUDIO_QUESTIONS_MAX);

export type StudioCastAnswer = z.infer<typeof answersSchema>[number];

export const studioCastRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("draft"), storyId: id, answers: answersSchema }),
  z.object({
    /** One more character or place the author asked for by name. */
    mode: z.literal("add"),
    storyId: id,
    answers: answersSchema,
    type: z.enum(STUDIO_CAST_TYPES),
    name: z.string().trim().min(1).max(NAME_MAX),
    note: z.string().trim().max(STUDIO_CAST_NOTE_MAX_CHARS),
  }),
]);

export type StudioCastRequest = z.infer<typeof studioCastRequestSchema>;
export type StudioCastMode = StudioCastRequest["mode"];

const pickInstructionSchema = z.object({
  kind: z.literal("pick"),
  question: z.string().trim().min(1).max(PICK_TEXT_MAX),
  choice: z
    .string()
    .trim()
    .min(1)
    .max(PICK_TEXT_MAX * 2),
});

const nudgeInstructionSchema = z.object({
  kind: z.literal("nudge"),
  text: z.string().trim().min(1).max(STUDIO_CAST_NUDGE_MAX_CHARS),
});

/**
 * The author's direction for a revision. It is an instruction to the model,
 * never stored as AI output, so taking its text from the browser is fine.
 */
export const studioCastInstructionSchema = z.discriminatedUnion("kind", [
  pickInstructionSchema,
  nudgeInstructionSchema,
]);

export type StudioCastInstruction = z.infer<typeof studioCastInstructionSchema>;

export const studioCastReviseRequestSchema = z.object({
  storyId: id,
  entryId: id,
  instruction: studioCastInstructionSchema,
});

export const studioCastPicksRequestSchema = z.object({
  storyId: id,
  entryId: id,
  /** Questions already offered for this entry, so none repeat. */
  asked: z.array(z.string().max(PICK_TEXT_MAX)).max(30),
});

/**
 * Model output schemas: strict-safe (every key required, no bounds, no
 * records). Limits are applied by the normalize functions below.
 */
const pickOutputSchema = z.object({
  question: z.string(),
  options: z.array(z.object({ label: z.string(), hint: z.string() })),
});

const castMemberOutputSchema = z.object({
  name: z.string(),
  /** Verbatim words from the brain dump or answers that refer to it. */
  mention: z.string(),
  importance: z.enum(["lead", "supporting", "minor"]),
  summary: z.string(),
  fields: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      steerOnly: z.boolean(),
      backstoryOnly: z.boolean(),
    }),
  ),
  picks: z.array(pickOutputSchema),
});

export const studioCastOutputSchema = z.object({
  characters: z.array(castMemberOutputSchema),
  places: z.array(castMemberOutputSchema),
});

export const studioCastPicksOutputSchema = z.object({
  picks: z.array(pickOutputSchema),
});

export const studioCastReviseOutputSchema = z.object({
  /** The rewritten paragraph, or null to leave it as it is. */
  summary: z.string().nullable(),
  ops: studioRefreshFieldsOutputSchema.shape.ops,
});

/** For a place: lead is a central setting, minor a passing one. */
export type StudioCastImportance = z.infer<
  typeof castMemberOutputSchema
>["importance"];

export type StudioCastPick = {
  id: string;
  question: string;
  options: { id: string; label: string; hint: string }[];
};

export type StudioCastMember = {
  type: StudioCastType;
  name: string;
  importance: StudioCastImportance;
  summary: string;
  fields: StudioProposedField[];
  picks: StudioCastPick[];
};

export type StagedStudioCast = {
  mode: StudioCastMode;
  members: StudioCastMember[];
};

export type StagedStudioCastRevision = {
  summary: string | null;
  ops: StudioFieldRefreshOp[];
  /** The entry's revision when the model read it; the apply compares it. */
  sourceRevision: number;
};

export type StudioCastPreview = { generationId: string; count: number };
export type StudioCastRevisePreview = { generationId: string };
export type StudioCastPicksResponse = { picks: StudioCastPick[] };

export type StudioCastApplyResult = {
  entries: StudioEntryDto[];
  /** Questions to tune each new entry, keyed by entry id. */
  picks: Record<string, StudioCastPick[]>;
};

export type StudioCastRevisionApplyResult = {
  /** The saved entry, or null when it changed after the revision was made. */
  entry: StudioEntryDto | null;
  stale: boolean;
};

function clip(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

function generationFailed(message: string): ActionError {
  return new ActionError("GENERATION_FAILED", message);
}

/** Lowercase words only, so quoting, punctuation and spacing never matter. */
function searchable(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

// Words too common to prove a mention on their own ("the" in "The stranger").
const WEAK_MENTIONS = new Set([
  "a",
  "an",
  "the",
  "he",
  "she",
  "they",
  "him",
  "her",
  "his",
  "their",
  "my",
  "our",
  "mr",
  "mrs",
  "ms",
  "dr",
  "old",
  "young",
]);

// Titles and family roles: "Uncle" in "Uncle Joe" proves nothing about Joe.
const ROLE_WORDS = new Set([
  "aunt",
  "uncle",
  "mother",
  "father",
  "mom",
  "mum",
  "dad",
  "brother",
  "sister",
  "grandma",
  "grandpa",
  "grandmother",
  "grandfather",
  "cousin",
  "captain",
  "doctor",
  "officer",
  "detective",
  "professor",
  "king",
  "queen",
  "lord",
  "lady",
  "sir",
  "miss",
  "mister",
]);

/**
 * The first word of a multi-word proper name ("Mara" of "Mara Quinn"), or ""
 * when it cannot stand for the person: a possessive ("Mara's father"), a
 * title or role, or a lowercase word.
 */
function firstNameOf(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (words.length < 2 || !/^\p{Lu}/u.test(first) || /['’]/.test(first)) {
    return "";
  }
  return ROLE_WORDS.has(first.toLowerCase()) ? "" : first;
}

/**
 * True when the author's own text refers to this character or place: the
 * model's verbatim mention, the full name, or (for a person) a plain first
 * name appears as whole words. A lone common word never counts. A place gets
 * no first-word fallback: "Blue" proves nothing about "Blue Door Café".
 */
export function isMentionedIn(
  source: string,
  member: { type: StudioCastType; name: string; mention: string },
): boolean {
  const haystack = searchable(source);
  const candidates = [
    member.mention,
    member.name,
    member.type === "character" ? firstNameOf(member.name) : "",
  ];
  return candidates.some((candidate) => {
    const needle = searchable(candidate).trim();
    return (
      needle.length >= 2 &&
      !WEAK_MENTIONS.has(needle) &&
      haystack.includes(` ${needle} `)
    );
  });
}

export function normalizeCastPicks(
  raw: z.infer<typeof pickOutputSchema>[],
  makeId: (prefix: string) => string,
  asked: string[] = [],
): StudioCastPick[] {
  const seen = new Set(asked.map((question) => searchable(question)));
  const picks: StudioCastPick[] = [];
  for (const item of raw) {
    if (picks.length >= STUDIO_CAST_MAX_PICKS) break;
    const question = clip(item.question, PICK_TEXT_MAX);
    const key = searchable(question);
    if (!question || seen.has(key)) continue;
    const options = item.options
      .map((option) => ({
        id: makeId("cast-option"),
        label: clip(option.label, PICK_TEXT_MAX),
        hint: clip(option.hint, PICK_TEXT_MAX),
      }))
      .filter((option) => option.label);
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) continue;
    seen.add(key);
    picks.push({ id: makeId("cast-pick"), question, options });
  }
  return picks;
}

function normalizeFields(
  raw: z.infer<typeof castMemberOutputSchema>["fields"],
): StudioProposedField[] {
  const seen = new Set<string>();
  const fields: StudioProposedField[] = [];
  for (const field of raw) {
    if (fields.length >= STUDIO_CAST_MAX_FIELDS) break;
    const label = cleanFieldLabel(field.label).slice(0, LABEL_MAX).trim();
    const value = field.value.trim().slice(0, VALUE_MAX);
    const key = normalizeFieldLabel(label);
    if (!label || !value || seen.has(key)) continue;
    seen.add(key);
    fields.push({
      label,
      value,
      steerOnly: field.steerOnly,
      backstoryOnly: field.backstoryOnly,
    });
  }
  return fields;
}

const IMPORTANCE_ORDER: Record<StudioCastImportance, number> = {
  lead: 0,
  supporting: 1,
  minor: 2,
};

/**
 * Keeps only characters and places the author's text mentions (in "draft"
 * mode), drops duplicate and existing names, applies the limits, and orders
 * leads first. `source` is the brain dump plus answers; `existingNames` are
 * `type:lowercase name` keys. An "add" keeps the one entry of `addType`.
 */
export function normalizeStudioCast(
  raw: z.infer<typeof studioCastOutputSchema>,
  options: {
    mode: StudioCastMode;
    addType?: StudioCastType;
    source: string;
    existingNames: Set<string>;
    makeId: (prefix: string) => string;
  },
): StagedStudioCast {
  const names = new Set(options.existingNames);
  const members: StudioCastMember[] = [];
  const lists: [StudioCastType, typeof raw.characters][] = [
    ["character", raw.characters],
    ["place", raw.places],
  ];
  for (const [type, list] of lists) {
    if (options.mode === "add" && type !== options.addType) continue;
    const limit = options.mode === "add" ? 1 : STUDIO_CAST_MAX_MEMBERS[type];
    let kept = 0;
    // Leads first before the cap, so a long list never cuts a lead.
    const ranked = [...list].sort(
      (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance],
    );
    for (const item of ranked) {
      if (kept >= limit) break;
      const name = clip(item.name, NAME_MAX);
      const key = `${type}:${name.toLowerCase()}`;
      if (!name || names.has(key)) continue;
      if (
        options.mode === "draft" &&
        !isMentionedIn(options.source, { ...item, type })
      ) {
        continue;
      }
      names.add(key);
      kept += 1;
      members.push({
        type,
        name,
        importance: item.importance,
        summary: clip(item.summary, SUMMARY_MAX),
        fields: normalizeFields(item.fields),
        picks: normalizeCastPicks(item.picks, options.makeId),
      });
    }
  }
  if (options.mode === "add" && members.length === 0) {
    throw generationFailed("It could not be drafted. Try again.");
  }
  return { mode: options.mode, members };
}
