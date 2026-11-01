import { z } from "zod";
import type { StoryGenerationModel } from "@/lib/story-generation-models";
import type { StudioBundleDto } from "@/lib/studio/bundle-contract";

export type StudioEntryType =
  | "character"
  | "relationship"
  | "place"
  | "thing"
  | "lore"
  | "custom";

/** Free-text label chosen by the author or the AI, e.g. "Trusts Mara". */
export type StudioAspect = string;

/** `set` replaces the aspect's value; `add` appends to a list. */
export type StudioChangeMode = "set" | "add";

export type StudioPlanKind = "chapter" | "scene" | "moment";

export type StudioPlanField =
  | "title"
  | "whatHappens"
  | "howToWrite"
  | "craft"
  | "presentEntryIds";

export type StudioStructureTemplateId =
  | "romance"
  | "coming-of-age"
  | "quiet"
  | "freeform";

export type StudioSetupStatus = "draft" | "planned";
export type StudioPlanOrigin = "ai" | "author";
export type StudioChangeSource = "planned" | "read-back" | "author";
export type StudioChangeStatus = "planned" | "confirmed";
export type StudioProseOrigin = "ai" | "author" | "ai-edited";
export type StudioFlagKind = "unplanned-change" | "missing-planned-change";
export type StudioFlagStatus = "open" | "resolved" | "dismissed";

/** The pre-Amendment-A stored shape: one value per fixed template key. */
export type StudioFieldValue = { value: string; author: "ai" | "author" };

export type StudioEntryField = {
  id: string;
  label: string;
  value: string;
  author: "ai" | "author";
  /** The AI uses it to steer but never says it. */
  steerOnly: boolean;
  /** Never surfaces in present-day moment prompts. */
  backstoryOnly: boolean;
};

export const studioEntryFieldSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().trim().min(1).max(80),
  // Matches the Phase 1 limit so long legacy values stay editable.
  value: z.string().max(20_000),
  author: z.enum(["ai", "author"]),
  steerOnly: z.boolean(),
  backstoryOnly: z.boolean(),
});

/** The edit schema's cap. Nothing may leave an entry with more fields. */
export const STUDIO_MAX_ENTRY_FIELDS = 40;

export const studioEntryFieldsSchema = z
  .array(studioEntryFieldSchema)
  .max(STUDIO_MAX_ENTRY_FIELDS);

export type StudioStyle = {
  povAndTense: string;
  register: string;
  pacing: string;
  avoid: string;
  notes: string;
};

export type StudioVoiceSample = { id: string; label: string; text: string };

export type StudioFlagPayload =
  | {
      kind: "unplanned-change";
      entryId: string;
      aspect: StudioAspect;
      mode: StudioChangeMode;
      aboutEntryId: string | null;
      value: string;
    }
  | { kind: "missing-planned-change"; changeId: string };

export type StudioStoryDto = {
  id: string;
  title: string;
  overview: string;
  instructions: string;
  style: StudioStyle;
  theme: string;
  structureTemplate: StudioStructureTemplateId;
  structureNotes: string;
  brainDump: string;
  voiceSamples: StudioVoiceSample[];
  proseModel: StoryGenerationModel;
  /** The agent chat's model; one of the existing generation profiles. */
  chatModel: StoryGenerationModel;
  setupStatus: StudioSetupStatus;
  createdAt: string;
  updatedAt: string;
};

export type StudioEntryDto = {
  id: string;
  storyId: string;
  type: StudioEntryType;
  customTypeLabel: string;
  name: string;
  summary: string;
  fields: StudioEntryField[];
  relatedEntryIds: string[];
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type StudioPlanItemDto = {
  id: string;
  storyId: string;
  parentId: string | null;
  kind: StudioPlanKind;
  position: number;
  title: string;
  whatHappens: string;
  howToWrite: string;
  craft: Record<string, string>;
  presentEntryIds: string[];
  contextPinnedEntryIds: string[];
  contextExcludedEntryIds: string[];
  authorFields: StudioPlanField[];
  origin: StudioPlanOrigin;
  summary: string;
  tension: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type StudioChangeDto = {
  id: string;
  storyId: string;
  entryId: string;
  aboutEntryId: string | null;
  aspect: StudioAspect;
  mode: StudioChangeMode;
  value: string;
  planItemId: string;
  position: number;
  source: StudioChangeSource;
  status: StudioChangeStatus;
  authorEdited: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StudioProseDto = {
  momentId: string;
  storyId: string;
  markdown: string;
  origin: StudioProseOrigin;
  revision: number;
  wordCount: number;
  readBackSourceHash: string;
  readBackSentenceHashes: string[];
  updatedAt: string;
};

export type StudioFlagDto = {
  id: string;
  storyId: string;
  planItemId: string;
  kind: StudioFlagKind;
  payload: StudioFlagPayload;
  status: StudioFlagStatus;
  createdAt: string;
  updatedAt: string;
};

export type StudioWorkspace = {
  story: StudioStoryDto;
  entries: StudioEntryDto[];
  planItems: StudioPlanItemDto[];
  changes: StudioChangeDto[];
  prose: StudioProseDto[];
  flags: StudioFlagDto[];
  /** Pending bundles plus the most recent accepted ones (for undo). */
  bundles: StudioBundleDto[];
};

export const STUDIO_MAX_VOICE_SAMPLES = 3;
export const STUDIO_MAX_VOICE_SAMPLE_CHARS = 4000;

export const studioChangeModeSchema = z.enum(["set", "add"]);

/** Stored aspect labels: 1-60 characters once trimmed. */
export const studioAspectSchema = z.string().trim().min(1).max(60);

export const studioStyleSchema = z.object({
  povAndTense: z.string(),
  register: z.string(),
  pacing: z.string(),
  avoid: z.string(),
  notes: z.string(),
});

export const studioVoiceSamplesSchema = z
  .array(
    z.object({
      id: z.string().min(1),
      label: z.string(),
      text: z.string().max(STUDIO_MAX_VOICE_SAMPLE_CHARS),
    }),
  )
  .max(STUDIO_MAX_VOICE_SAMPLES);

export const studioFieldsSchema = z.record(
  z.string(),
  z.object({ value: z.string(), author: z.enum(["ai", "author"]) }),
);

export const studioCraftSchema = z.record(z.string(), z.string());

export const studioIdListSchema = z.array(z.string().min(1));

export const studioFlagPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unplanned-change"),
    entryId: z.string().min(1),
    aspect: studioAspectSchema,
    mode: studioChangeModeSchema,
    aboutEntryId: z.string().min(1).nullable(),
    value: z.string(),
  }),
  z.object({
    kind: z.literal("missing-planned-change"),
    changeId: z.string().min(1),
  }),
]);

export const EMPTY_STUDIO_STYLE: StudioStyle = {
  povAndTense: "",
  register: "",
  pacing: "",
  avoid: "",
  notes: "",
};
