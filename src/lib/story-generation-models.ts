import { z } from "zod";

export const STORY_GENERATION_MODELS = [
  {
    value: "deepseek-v4-1-flash-1017-uncensored",
    label: "DeepSeek V4.1 Flash 1017 Uncensored",
  },
  { value: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro 0813" },
  { value: "kimi-k3-1-pro", label: "Kimi K3.1 Pro (Anonymized)" },
  { value: "grok-4-7", label: "Grok 4.7" },
  { value: "z-ai-glm-5-3", label: "GLM 5.3" },
] as const;

export type StoryGenerationModel =
  (typeof STORY_GENERATION_MODELS)[number]["value"];

export const DEFAULT_STORY_GENERATION_MODEL =
  "deepseek-v4-1-flash-1017-uncensored";

export const storyGenerationModelSchema = z.enum(
  STORY_GENERATION_MODELS.map(({ value }) => value),
);
