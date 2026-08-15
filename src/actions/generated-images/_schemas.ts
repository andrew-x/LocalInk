import { z } from "zod";

import {
  DEFAULT_GENERATED_IMAGE_ASPECT_RATIO,
  DEFAULT_GENERATED_IMAGE_MODEL,
  DEFAULT_GENERATED_IMAGE_SIZE,
  DEFAULT_GENERATED_IMAGE_STYLE_PRESET,
  GENERATED_IMAGE_ASPECT_RATIOS,
  GENERATED_IMAGE_MODELS,
  GENERATED_IMAGE_SIZES,
  GENERATED_IMAGE_STYLE_PRESET_OPTIONS,
} from "@/lib/generated-images";

const generatedImageModelSchema = z.enum(
  GENERATED_IMAGE_MODELS.map((model) => model.id),
);
const generatedImageStylePresetSchema = z.enum(
  GENERATED_IMAGE_STYLE_PRESET_OPTIONS.map((preset) => preset.id),
);
const generatedImageAspectRatioSchema = z.enum(GENERATED_IMAGE_ASPECT_RATIOS);
const generatedImageSizeSchema = z.enum(GENERATED_IMAGE_SIZES);

export const generateImageFormSchema = z.object({
  aspectRatio: generatedImageAspectRatioSchema.default(
    DEFAULT_GENERATED_IMAGE_ASPECT_RATIO,
  ),
  imageSize: generatedImageSizeSchema.default(DEFAULT_GENERATED_IMAGE_SIZE),
  model: generatedImageModelSchema.default(DEFAULT_GENERATED_IMAGE_MODEL),
  prompt: z
    .string()
    .trim()
    .min(1, "Image description is required.")
    .max(4000, "Image description must be 4,000 characters or fewer."),
  stylePreset: generatedImageStylePresetSchema.default(
    DEFAULT_GENERATED_IMAGE_STYLE_PRESET,
  ),
  stylePrompt: z
    .string()
    .trim()
    .max(2000, "Style prompt must be 2,000 characters or fewer."),
});

/**
 * Generation carries both descriptions: `prompt` is always what the user typed,
 * and `enhancedPrompt` is set only when the enhanced version is the one to send.
 * The server decides which reaches the provider and which is kept as the
 * original, so the user's own wording survives the generation.
 */
export const generateImageActionSchema = generateImageFormSchema.extend({
  enhancedPrompt: z
    .string()
    .trim()
    .max(4000, "Enhanced description must be 4,000 characters or fewer.")
    .optional(),
});

export const enhanceImagePromptActionSchema = generateImageFormSchema;

export const deleteGeneratedImageActionSchema = z.object({
  id: z.string().trim().min(1, "Image id is required."),
});

export const deleteGeneratedImagesActionSchema = z.object({
  ids: z
    .array(z.string().trim().min(1, "Image id is required."))
    .min(1, "Select at least one image.")
    .max(500, "Delete 500 images or fewer at a time."),
});

export type GenerateImageFormValues = z.infer<typeof generateImageFormSchema>;
