import { z } from "zod";

import type {
  StudioStoryDto,
  StudioVoiceMoment,
  StudioVoicePick,
} from "@/lib/studio/contracts";
import { STUDIO_REWRITE_MAX_SELECTION_CHARS } from "@/lib/studio/rewrite-contract";
import { STUDIO_VOICE_LIMITS, type StudioVoiceOp } from "@/lib/studio/voice";

const id = z.string().trim().min(1).max(128);
const kind = z.string().trim().min(1).max(STUDIO_VOICE_LIMITS.kindChars);

export const STUDIO_VOICE_COMPLAINT_MAX_CHARS = 500;

export const studioVoicePicksRequestSchema = z.object({
  storyId: id,
  mode: z.enum(["setup", "more"]),
});

export const studioVoiceSampleRequestSchema = z.object({
  storyId: id,
  kind,
  planItemId: id.nullable(),
});

export const studioVoiceFeedbackRequestSchema = z.object({
  storyId: id,
  kind,
  sample: z.union([z.object({ generationId: id }), z.object({ sampleId: id })]),
  complaint: z.string().trim().min(1).max(STUDIO_VOICE_COMPLAINT_MAX_CHARS),
});

export const studioVoiceTuneRequestSchema = z.object({
  storyId: id,
  momentId: id,
  selectedText: z.string().min(1).max(STUDIO_REWRITE_MAX_SELECTION_CHARS),
  complaint: z.string().trim().min(1).max(STUDIO_VOICE_COMPLAINT_MAX_CHARS),
});

/** Model output. Strict-safe: every key required, no bounds. */
export const voicePicksOutputSchema = z.object({
  picks: z.array(
    z.object({
      label: z.string(),
      question: z.string(),
      why: z.string(),
      options: z.array(z.object({ label: z.string(), hint: z.string() })),
      suggestedIndex: z.number(),
    }),
  ),
  moments: z.array(
    z.object({ kind: z.string(), planItemId: z.string().nullable() }),
  ),
});

export const voiceChangesOutputSchema = z.object({
  pickChanges: z.array(
    z.object({
      pickId: z.string(),
      optionId: z.string().nullable(),
      custom: z.string().nullable(),
    }),
  ),
  newNotes: z.array(z.string()),
});

/** A rewrite under the proposed voice, with the voice changes behind it. */
export type StudioVoiceTunePreview = {
  generationId: string;
  rewrite: string;
  ops: StudioVoiceOp[];
};

export type StudioVoicePicksPreview = {
  generationId: string;
  picks: StudioVoicePick[];
  moments: { kind: string; planItemId: string | null }[];
};

export type StudioVoiceSamplePreview = {
  generationId: string;
  text: string;
  planItemId: string | null;
};

/** Only "choose" and "add-note" ops. */
export type StudioVoiceChangesPreview = {
  generationId: string;
  ops: StudioVoiceOp[];
};

export type StagedStudioVoicePicks = {
  picks: StudioVoicePick[];
  moments: StudioVoiceMoment[];
};

export type StagedStudioVoiceSample = {
  kind: string;
  text: string;
  planItemId: string | null;
  fingerprint: string;
};

export type StagedStudioVoiceChanges = { ops: StudioVoiceOp[] };

export type StudioVoiceChangesApplyResult = {
  story: StudioStoryDto;
  undoOps: StudioVoiceOp[];
};
