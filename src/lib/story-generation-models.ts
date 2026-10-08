import { z } from "zod";

export const STORY_GENERATION_MODELS = [
  { value: "deepseekV4Pro", label: "DeepSeek V4 Pro" },
  { value: "kimiK3", label: "Kimi K3" },
  { value: "glm53", label: "GLM 5.3" },
  { value: "mistralLarge40", label: "Mistral Large 4.0" },
] as const;

export type StoryGenerationModel =
  (typeof STORY_GENERATION_MODELS)[number]["value"];

export const DEFAULT_STORY_GENERATION_MODEL = "deepseekV4Pro";

export const storyGenerationModelSchema = z.enum(
  STORY_GENERATION_MODELS.map(({ value }) => value),
);
