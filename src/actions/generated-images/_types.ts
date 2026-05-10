import type {
  GeneratedImageAspectRatio,
  GeneratedImageModel,
  GeneratedImageSize,
  GeneratedImageStylePreset,
} from "@/lib/generated-images";

export type GeneratedImageListItem = {
  aspectRatio: string;
  contentUrl: string;
  createdAt: string;
  height: number | null;
  id: string;
  imageSize: string;
  mimeType: string;
  model: string;
  prompt: string;
  stylePreset: GeneratedImageStylePreset;
  stylePrompt: string;
  width: number | null;
};

export type GeneratedImageDetail = GeneratedImageListItem & {
  fileSize: number;
  provider: string;
  providerResponseId: string | null;
};

export type DeleteGeneratedImagesResult = {
  ids: string[];
};

export type GeneratedImageDefaults = {
  aspectRatio: GeneratedImageAspectRatio;
  imageSize: GeneratedImageSize;
  model: GeneratedImageModel;
  stylePreset: GeneratedImageStylePreset;
  stylePrompt: string;
};
