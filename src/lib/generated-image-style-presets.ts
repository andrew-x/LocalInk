export const GENERATED_IMAGE_BUILT_IN_STYLE_PRESET_IDS = [
  "amateur-photo",
  "2000s-point-and-shoot",
  "disposable-camera",
  "instant-film",
  "social-media-photo",
  "candid-street-photo",
  "nightlife-party-photo",
  "professional-posed-photo",
  "cinematic-photo",
  "classic-film-camera",
] as const;

export const CUSTOM_GENERATED_IMAGE_STYLE_PRESET = "custom";

export const GENERATED_IMAGE_STYLE_PRESET_IDS = [
  ...GENERATED_IMAGE_BUILT_IN_STYLE_PRESET_IDS,
  CUSTOM_GENERATED_IMAGE_STYLE_PRESET,
] as const;

export type GeneratedImageBuiltInStylePreset =
  (typeof GENERATED_IMAGE_BUILT_IN_STYLE_PRESET_IDS)[number];

export type GeneratedImageStylePreset =
  (typeof GENERATED_IMAGE_STYLE_PRESET_IDS)[number];
