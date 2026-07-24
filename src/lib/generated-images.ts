import {
  CUSTOM_GENERATED_IMAGE_STYLE_PRESET,
  type GeneratedImageBuiltInStylePreset,
  type GeneratedImageStylePreset,
} from "@/lib/generated-image-style-presets";

export {
  CUSTOM_GENERATED_IMAGE_STYLE_PRESET,
  GENERATED_IMAGE_STYLE_PRESET_IDS,
  type GeneratedImageStylePreset,
} from "@/lib/generated-image-style-presets";

export const GENERATED_IMAGE_MODELS = [
  {
    id: "openai/gpt-image-2/text-to-image",
    name: "GPT Image 2",
    outputModalities: ["image"],
    provider: "wavespeed",
    providerModelId: "openai/gpt-image-2/text-to-image",
  },
  {
    id: "google/gemini-3-pro-image-preview",
    name: "Nano Banana Pro",
    outputModalities: ["image", "text"],
    provider: "openrouter",
    providerModelId: "google/gemini-3-pro-image-preview",
  },
  {
    id: "google/gemini-3.1-flash-image-preview",
    name: "Nano Banana 2",
    outputModalities: ["image", "text"],
    provider: "openrouter",
    providerModelId: "google/gemini-3.1-flash-image-preview",
  },
  {
    id: "bytedance-seed/seedream-4.5",
    name: "Seedream 4.5",
    outputModalities: ["image"],
    provider: "openrouter",
    providerModelId: "bytedance-seed/seedream-4.5",
  },
  {
    id: "bytedance/seedream-v5.0-pro",
    name: "Seedream 5 Pro",
    outputModalities: ["image"],
    provider: "wavespeed",
    providerModelId: "bytedance/seedream-v5.0-pro",
  },
] as const;

export const GENERATED_IMAGE_STYLE_PRESETS = [
  {
    id: "amateur-photo",
    name: "Amateur photo",
    prompt:
      "Casual smartphone snapshot, like a photo your friend would take of you. Modern phone wide lens (~26mm equivalent) with HDR-blended exposure, mixed available light (daylight plus warm interior bulbs is fine), slight handheld motion, slightly off-center or crooked framing, mild luminance noise in shadows. The subject is an ordinary real person — relatable, not striking — with natural unstyled hair (a few flyaways, possibly slightly messy), unretouched skin that shows real pores, freckles, redness or minor blemishes, everyday clothing that may be wrinkled or unremarkable, and a candid unposed expression mid-action or mid-conversation. The background is not curated — everyday clutter, mundane interiors, and imperfect composition are welcome.",
  },
  {
    id: "2000s-point-and-shoot",
    name: "2000s point-and-shoot",
    prompt:
      "High-quality recreation of an early-2000s consumer digital point-and-shoot photo, like a compact pocket camera snapshot, not a modern phone photo and not a low-resolution file. Built-in direct flash or harsh on-camera fill when appropriate, small-sensor deep focus, 35mm-equivalent wide-normal lens, slightly flattened perspective, crisp edges, hard specular highlights, mild shadow sensor noise, and bright flash foregrounds falling into darker ambient backgrounds. Auto white balance can lean cool indoors or slightly green under fluorescents; colors feel punchy but believable with a JPEG-era consumer-camera response. Casual imperfect crop, ordinary clutter, house-party, mall, bedroom, diner, school, or night-out snapshot energy. Avoid compression artifacts, pixelation, fake nostalgia filters, sepia, heavy blur, disposable-camera light leaks, VHS artifacts, and visible date stamps unless the subject explicitly asks for one.",
  },
  {
    id: "disposable-camera",
    name: "Disposable camera",
    prompt:
      "High-quality recreation of a single-use 35mm color disposable camera snapshot, with the vibe of a real printed drugstore photo rather than a damaged scan. Fixed-focus plastic lens character, built-in flash, deep depth of field, simple center-weighted exposure, mild corner falloff, slight edge softness, clean fine film grain, and bright flash foregrounds that fall into darker ambient backgrounds. Colors should feel like consumer color negative film: warm skin, punchy reds and yellows, slightly cool shadows, modest contrast, and imperfect everyday framing. Preserve clear subject detail and believable skin texture; avoid low resolution, pixelation, heavy blur, scratches, dust, fake light leaks, torn paper, sepia, VHS artifacts, and visible date stamps unless specifically requested.",
  },
  {
    id: "instant-film",
    name: "Instant film",
    prompt:
      "High-quality recreation of a fresh instant film photograph, like Polaroid or Instax color film, with the color response and tonal softness of instant chemistry but not a degraded old print. Soft contrast, gentle highlight bloom, creamy rolloff, slightly pastel colors, warm skin tones, cool cyan-green shadows, modest dynamic range, subtle film texture, and simple close-range composition. Feels tactile, intimate, and candid, with clean real-camera detail beneath the softer tonality. Avoid low resolution, muddy blur, sepia, scratched or stained paper, fake aging, excessive fading, heavy vignettes, light leaks, and adding a white instant-film border unless the subject explicitly asks for one.",
  },
  {
    id: "social-media-photo",
    name: "Social media photo",
    prompt:
      "Lifestyle photo for a normal person's social media — the kind a friend with a few hundred followers would post, not an influencer or brand campaign. Soft flattering light from a large window or single softbox, deliberate but uncontrived framing, shallow depth of field from a ~50mm f/1.8 lens. The subject is a real ordinary person with natural skin texture preserved beneath light or no makeup, hair styled casually but not salon-perfect (some natural movement and stray strands), relatable proportions, and a genuine candid expression rather than a posed model look. Modern phone-camera color grade with gently lifted shadows and a subtle warm cast. Reads as well-shot and lightly edited, never retouched or AI-perfected.",
  },
  {
    id: "candid-street-photo",
    name: "Candid street photo",
    prompt:
      "Candid documentary street photograph capturing an unposed real-life moment, as if taken by an observant photographer moving through the scene. 28mm or 35mm rangefinder-style lens, available light, zone-focus feel with enough depth of field to hold the subject and surrounding context, crisp real-camera detail, natural motion in gestures without low-quality blur. Composition should feel found rather than staged: off-center framing, layered foreground and background, ordinary street or public-space details, imperfect timing, spontaneous body language, and people who look unaware of the camera or mid-conversation. Natural color documentary grade with realistic contrast and skin tones; avoid studio lighting, fashion editorial posing, influencer polish, paparazzi flash, surveillance-camera angles, heavy retouching, and artificial candidness.",
  },
  {
    id: "nightlife-party-photo",
    name: "Nightlife party photo",
    prompt:
      "Candid nightlife and party photograph with direct on-camera flash, crisp real-camera detail, and spontaneous social energy. Bar, club, house party, concert, late-night diner, or street-after-midnight atmosphere; bright flash-lit faces and hands against darker ambient backgrounds, glossy highlights, saturated practical lights or neon, deep shadows, and a slight wide-angle close-range feel. People should look caught mid-laugh, mid-conversation, dancing, leaning into frame, or reacting naturally, with imperfect crop and crowded layered background details. Preserve believable skin texture and sharp focus on the main subject; avoid fashion editorial posing, influencer polish, paparazzi harassment, surveillance-camera angles, severe motion blur, red-eye, crushed black detail, fake low-resolution artifacts, and overprocessed nightclub HDR.",
  },
  {
    id: "professional-posed-photo",
    name: "Professional posed photo",
    prompt:
      "Professional studio portrait of an ordinary real person — the kind of headshot a normal person would book for a profile or work bio, not a fashion or commercial model. 85mm portrait lens at f/2.8, controlled three-point lighting with a softbox key, fill card, and a subtle hair or rim light, neutral seamless backdrop or a simple clean studio set, tack-sharp focus on the eyes. Preserve real human features: natural skin texture with visible pores, freckles, fine lines, and minor asymmetry; real hair with natural texture rather than heavy salon styling; natural body proportions; and a relaxed, slightly unguarded expression. Only the lightest retouching — no skin smoothing, no face slimming, no contouring, no idealization.",
  },
  {
    id: "cinematic-photo",
    name: "Cinematic photo",
    prompt:
      "Cinematic film still shot on 35mm, in the style of a character-driven contemporary indie film. Anamorphic or fast prime lens with shallow depth of field and oval bokeh, motivated practical-source key light with deep ambient shadow, naturalistic production design, restrained desaturated color grade, fine organic film grain. The subject is cast for realism rather than glamour — an everyday-looking person with naturalistic features, lived-in skin showing real texture and slight imperfections, real hair, and costume that reads as actual clothing rather than fashion editorial. Framing and lighting read as composed by a cinematographer, not rendered by a computer.",
  },
  {
    id: "classic-film-camera",
    name: "Classic film camera",
    prompt:
      "High-resolution color photograph with a modern mirrorless-camera film simulation look inspired by classic color film and 20th-century documentary magazine photography, not black-and-white and not a degraded vintage scan. Real-camera sharpness with clean fine detail, a 35mm or 50mm prime lens feel, natural available light, gentle highlight rolloff, crisp but not clinical microcontrast, and only fine organic grain. Muted color palette with subdued saturation, suppressed magenta, cool blue-green shadows, warm skin-friendly highlights, earthy reds and yellows, olive greens, and slightly faded print-like color separation. Preserve accurate focus, high resolution, natural skin texture, and believable material detail; avoid sepia, monochrome, scratches, dust, light leaks, blur, low-definition softness, Polaroid damage, VHS artifacts, and fake aged-paper effects.",
  },
] as const satisfies ReadonlyArray<{
  id: GeneratedImageBuiltInStylePreset;
  name: string;
  prompt: string;
}>;

export const GENERATED_IMAGE_STYLE_PRESET_OPTIONS = [
  ...GENERATED_IMAGE_STYLE_PRESETS,
  {
    id: CUSTOM_GENERATED_IMAGE_STYLE_PRESET,
    name: "Custom",
    prompt: "",
  },
] as const;

export const GENERATED_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

export const GENERATED_IMAGE_SIZES = ["1K", "2K", "4K"] as const;

export const DEFAULT_GENERATED_IMAGE_MODEL = "openai/gpt-image-2/text-to-image";
export const DEFAULT_GENERATED_IMAGE_STYLE_PRESET = "amateur-photo";
export const DEFAULT_GENERATED_IMAGE_ASPECT_RATIO = "1:1";
export const DEFAULT_GENERATED_IMAGE_SIZE = "1K";

const GENERATED_IMAGE_DOWNLOAD_EXTENSION_BY_MIME_TYPE = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

const LEGACY_GENERATED_IMAGE_MODEL_REPLACEMENTS = {
  "google/gemini-2.5-flash-image": "google/gemini-3-pro-image-preview",
} as const;

export type GeneratedImageModel = (typeof GENERATED_IMAGE_MODELS)[number]["id"];
export type GeneratedImageModelConfig = (typeof GENERATED_IMAGE_MODELS)[number];
export type GeneratedImageOutputModalities =
  (typeof GENERATED_IMAGE_MODELS)[number]["outputModalities"];
export type GeneratedImageProvider = GeneratedImageModelConfig["provider"];
export type GeneratedImageAspectRatio =
  (typeof GENERATED_IMAGE_ASPECT_RATIOS)[number];
export type GeneratedImageSize = (typeof GENERATED_IMAGE_SIZES)[number];

export const IMAGE_ONLY_INSTRUCTIONS = [
  "Generate exactly one image.",
  "Return image output only.",
  "Do not return captions, prose, markdown, commentary, JSON, code fences, or any other non-image content.",
  "If text output would normally be included, omit it and return only the generated image.",
] as const;

export const PHOTOREALISM_INSTRUCTIONS = [
  "Every output is a real photograph. Do not produce illustrations, paintings, drawings, comics, anime, 3D renders, CGI, or any AI-stylized artwork.",
  "Render natural skin with visible pores, fine hairs, and minor blemishes or asymmetry. Avoid waxy, plastic, or airbrushed skin.",
  "Use physically plausible lighting, shadows, and reflections. Preserve realistic depth of field with lens-shaped (not perfectly circular) bokeh.",
  "Keep colors and contrast believable for the depicted lighting conditions. Avoid oversaturation, HDR halos, and a glossy AI sheen.",
  "When the subject is a person, render them as an ordinary real human — the kind of person you'd actually know — not a fashion model, influencer, or AI-beautified ideal. Allow realistic skin variation (pores, freckles, minor redness, small blemishes, light asymmetry), realistic hair with natural texture and stray flyaways, realistic body proportions for the implied context, and a relaxed, candid expression. Do not slim, smooth, contour, or idealize the face or body. Faces should be relatable rather than striking.",
] as const;

export const PHOTOREALISM_NEGATIVE_PROMPT =
  "supermodel or fashion-model features, influencer face, magazine-cover beauty, idealized or hyper-attractive features, face slimming, skin smoothing, contoured cheekbones, perfect symmetry, salon-perfect hair, plastic or waxy skin, airbrushed faces, heavy makeup glamour look, oversaturated colors, perfectly circular bokeh, generic stock-photo backdrop, AI sheen, CGI, 3D render, illustration, painting, anime, cartoon";

export function getGeneratedImageDefaults(): {
  aspectRatio: GeneratedImageAspectRatio;
  imageSize: GeneratedImageSize;
  model: GeneratedImageModel;
  stylePreset: GeneratedImageStylePreset;
  stylePrompt: string;
} {
  return {
    aspectRatio: DEFAULT_GENERATED_IMAGE_ASPECT_RATIO,
    imageSize: DEFAULT_GENERATED_IMAGE_SIZE,
    model: DEFAULT_GENERATED_IMAGE_MODEL,
    stylePreset: DEFAULT_GENERATED_IMAGE_STYLE_PRESET,
    stylePrompt: getGeneratedImageStylePresetPrompt(
      DEFAULT_GENERATED_IMAGE_STYLE_PRESET,
    ),
  };
}

export function getGeneratedImageDownloadFilename({
  id,
  mimeType,
}: {
  id: string;
  mimeType: string;
}): string {
  const extension =
    GENERATED_IMAGE_DOWNLOAD_EXTENSION_BY_MIME_TYPE[
      mimeType as keyof typeof GENERATED_IMAGE_DOWNLOAD_EXTENSION_BY_MIME_TYPE
    ] ?? "png";
  const safeId = id
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `localink-image-${safeId || "generated-image"}.${extension}`;
}

export function getGeneratedImageDownloadUrl(contentUrl: string): string {
  return `${contentUrl}${contentUrl.includes("?") ? "&" : "?"}download=1`;
}

export function getGeneratedImageStylePresetPrompt(
  preset: GeneratedImageStylePreset,
): string {
  return (
    GENERATED_IMAGE_STYLE_PRESETS.find((option) => option.id === preset)
      ?.prompt ?? ""
  );
}

export function normalizeGeneratedImageModel(
  model: string,
): GeneratedImageModel {
  if (isGeneratedImageModel(model)) {
    return model;
  }

  return (
    LEGACY_GENERATED_IMAGE_MODEL_REPLACEMENTS[
      model as keyof typeof LEGACY_GENERATED_IMAGE_MODEL_REPLACEMENTS
    ] ?? DEFAULT_GENERATED_IMAGE_MODEL
  );
}

export function getGeneratedImageModelConfig(
  model: GeneratedImageModel,
): GeneratedImageModelConfig {
  return (
    GENERATED_IMAGE_MODELS.find((option) => option.id === model) ??
    GENERATED_IMAGE_MODELS[0]
  );
}

export function getGeneratedImageOutputModalities(
  model: GeneratedImageModel,
): GeneratedImageOutputModalities {
  return getGeneratedImageModelConfig(model).outputModalities;
}

export function normalizeGeneratedImageAspectRatio(
  aspectRatio: string,
): GeneratedImageAspectRatio {
  return isGeneratedImageAspectRatio(aspectRatio)
    ? aspectRatio
    : DEFAULT_GENERATED_IMAGE_ASPECT_RATIO;
}

export function normalizeGeneratedImageSize(
  imageSize: string,
): GeneratedImageSize {
  return isGeneratedImageSize(imageSize)
    ? imageSize
    : DEFAULT_GENERATED_IMAGE_SIZE;
}

export function detectGeneratedImageStylePreset(
  stylePrompt: string,
): GeneratedImageStylePreset {
  const matchingPreset = GENERATED_IMAGE_STYLE_PRESETS.find(
    (preset) => preset.prompt === stylePrompt,
  );

  return matchingPreset?.id ?? CUSTOM_GENERATED_IMAGE_STYLE_PRESET;
}

export function normalizeGeneratedImageStylePreset({
  stylePreset,
  stylePrompt,
}: {
  stylePreset: GeneratedImageStylePreset;
  stylePrompt: string;
}): GeneratedImageStylePreset {
  if (stylePreset === CUSTOM_GENERATED_IMAGE_STYLE_PRESET) {
    return detectGeneratedImageStylePreset(stylePrompt);
  }

  return getGeneratedImageStylePresetPrompt(stylePreset) === stylePrompt
    ? stylePreset
    : CUSTOM_GENERATED_IMAGE_STYLE_PRESET;
}

export function buildGeneratedImageProviderPrompt({
  prompt,
  stylePrompt,
}: {
  prompt: string;
  stylePrompt: string;
}): string {
  const trimmedPrompt = prompt.trim();
  const trimmedStylePrompt = stylePrompt.trim();

  return [
    "Photographic style:",
    trimmedStylePrompt ||
      "Unstyled documentary photograph, ~35mm equivalent lens, available light, mild grain, no retouching.",
    "",
    "Subject:",
    trimmedPrompt,
    "",
    "Avoid:",
    PHOTOREALISM_NEGATIVE_PROMPT,
  ].join("\n");
}

export function buildGeneratedImageSystemInstruction(): string {
  return [...IMAGE_ONLY_INSTRUCTIONS, ...PHOTOREALISM_INSTRUCTIONS].join("\n");
}

function isGeneratedImageModel(model: string): model is GeneratedImageModel {
  return GENERATED_IMAGE_MODELS.some((option) => option.id === model);
}

function isGeneratedImageAspectRatio(
  aspectRatio: string,
): aspectRatio is GeneratedImageAspectRatio {
  return GENERATED_IMAGE_ASPECT_RATIOS.some((option) => option === aspectRatio);
}

function isGeneratedImageSize(
  imageSize: string,
): imageSize is GeneratedImageSize {
  return GENERATED_IMAGE_SIZES.some((option) => option === imageSize);
}
