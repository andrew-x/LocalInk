import {
  DEFAULT_STORY_GENERATION_MODEL,
  type StoryGenerationModel,
} from "@/lib/story-generation-models";

/** Writes manuscript prose: beats, scene drafts, rewrites, and voice samples. */
export const STUDIO_PROSE_MODEL: StoryGenerationModel = "deepseek-v4-pro-0813";

/** Handles all non-prose Studio work: planning, chat, read-back, and suggestions. */
export const STUDIO_ASSIST_MODEL: StoryGenerationModel =
  DEFAULT_STORY_GENERATION_MODEL;
