import { z } from "zod";

const MAX_CONTEXT_TEXT_LENGTH = 1_000_000;

const storyProseCharacterSchema = z.object({
  id: z.string().trim().max(128).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim(),
});

const storyProseLocationSchema = z.object({
  id: z.string().trim().max(128).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim(),
});

const storyProseStorySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
  // Durable per-story writer preferences. These reach the system prompt rather
  // than the request body, alongside the global ones, because they are
  // authority rather than request data.
  systemInstructions: z.string().trim().max(8_000).default(""),
});

const storyProseVoiceExemplarSchema = z.object({
  id: z.string().trim().max(128).optional(),
  label: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(4_000),
});

const storyProseChapterSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  position: z.number().int().positive(),
  content: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
  // Background-generated story state. Optional because it is empty until the
  // first refresh and briefly stale after an edit.
  synopsis: z.string().max(MAX_CONTEXT_TEXT_LENGTH).default(""),
});

const storyProseRegenerationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fresh-alternative"),
    // The attempt to move away from. Without it a fresh alternative is the
    // same request bytes as the first try, and sampling alone often returns
    // something close to the draft the writer just rejected.
    priorAttempt: z.string().max(MAX_CONTEXT_TEXT_LENGTH).optional(),
  }),
  z.object({
    editInstructions: z.string().trim().min(1).max(1_000),
    mode: z.literal("revise-prior-draft"),
    priorDraft: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
  }),
]);

export const storyProseGenerationRequestSchema = z.object({
  story: storyProseStorySchema,
  style: z.string(),
  characters: z.array(storyProseCharacterSchema).max(100),
  locations: z.array(storyProseLocationSchema).max(100),
  voiceExemplars: z.array(storyProseVoiceExemplarSchema).max(3).default([]),
  chapters: z.array(storyProseChapterSchema).max(500),
  focusedChapter: storyProseChapterSchema,
  insertion: z.object({
    beforeText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    afterText: z.string().max(MAX_CONTEXT_TEXT_LENGTH),
    atChapterEnd: z.boolean(),
    // Prose the writer selected to be replaced. Present only for a rewrite,
    // where the anchors sit either side of this span rather than the caret.
    selectedText: z.string().max(MAX_CONTEXT_TEXT_LENGTH).default(""),
  }),
  instructions: z.string().trim().max(2_000),
  // How the beat should move, as opposed to how long it should be. `auto`
  // leaves the choice to the model and emits no field at all.
  pacing: z
    .enum(["auto", "scene", "summary", "interior", "dialogue"])
    .default("auto"),
  // What is different once the beat is done. The brief says what happens;
  // this says what it changes, which is what pacing decisions hang on.
  beatGoal: z.string().trim().max(300).default(""),
  approximateLength: z.union([
    z.literal(200),
    z.literal(400),
    z.literal(600),
    z.literal(1_000),
    z.literal("unlimited"),
  ]),
  regeneration: storyProseRegenerationSchema.optional(),
});

export type StoryProseGenerationRequest = z.infer<
  typeof storyProseGenerationRequestSchema
>;
