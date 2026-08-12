// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import {
  buildGeneratedImageProviderPrompt,
  buildGeneratedImageSystemInstruction,
  DEFAULT_GENERATED_IMAGE_STYLE_PRESET,
  detectGeneratedImageStylePreset,
  GENERATED_IMAGE_ASPECT_RATIOS,
  GENERATED_IMAGE_MODELS,
  GENERATED_IMAGE_SIZES,
  GENERATED_IMAGE_STYLE_PRESETS,
  generatedImageModelPrefersAffirmativePrompt,
  generatedImageModelUsesOpenRouterImagesEndpoint,
  getGeneratedImageDefaults,
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
  getGeneratedImageModelPromptLimit,
  getGeneratedImageModelSubjectLimit,
  getGeneratedImageOutputModalities,
  getGeneratedImageStylePresetPrompt,
  IMAGE_ONLY_INSTRUCTIONS,
  normalizeGeneratedImageAspectRatio,
  normalizeGeneratedImageModel,
  normalizeGeneratedImageSize,
  normalizeGeneratedImageStylePreset,
  PHOTOREALISM_AFFIRMATIVE_PROMPT,
  PHOTOREALISM_AFFIRMATIVE_PROMPT_COMPACT,
  PHOTOREALISM_INSTRUCTIONS,
  PHOTOREALISM_NEGATIVE_PROMPT,
} from "./generated-images";

describe("generated image prompts and styles", () => {
  test("returns the configured default model and style prompt", () => {
    const defaults = getGeneratedImageDefaults();

    expect(defaults.model).toBe("openai/gpt-image-2/text-to-image");
    expect(defaults.stylePreset).toBe(DEFAULT_GENERATED_IMAGE_STYLE_PRESET);
    expect(defaults.stylePrompt).toBe(
      getGeneratedImageStylePresetPrompt(DEFAULT_GENERATED_IMAGE_STYLE_PRESET),
    );
  });

  test("detects custom style prompts when text no longer matches a preset", () => {
    const presetPrompt = getGeneratedImageStylePresetPrompt("amateur-photo");

    expect(detectGeneratedImageStylePreset(presetPrompt)).toBe("amateur-photo");
    expect(detectGeneratedImageStylePreset(`${presetPrompt} Extra.`)).toBe(
      "custom",
    );
    expect(
      normalizeGeneratedImageStylePreset({
        stylePreset: "amateur-photo",
        stylePrompt: `${presetPrompt} Extra.`,
      }),
    ).toBe("custom");
  });

  test("includes a high-quality color classic film camera style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "classic-film-camera",
    );

    expect(preset?.name).toBe("Classic film camera");
    expect(preset?.prompt).toContain("High-resolution color photograph");
    expect(preset?.prompt).toContain("not black-and-white");
    expect(preset?.prompt).toContain("fine organic grain");
    expect(preset?.prompt).toContain("avoid sepia");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "classic-film-camera",
    );
  });

  test("includes a 2000s point-and-shoot style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "2000s-point-and-shoot",
    );

    expect(preset?.name).toBe("2000s point-and-shoot");
    expect(preset?.prompt).toContain(
      "early-2000s consumer digital point-and-shoot photo",
    );
    expect(preset?.prompt).toContain("not a low-resolution file");
    expect(preset?.prompt).toContain("Built-in direct flash");
    expect(preset?.prompt).toContain("small-sensor deep focus");
    expect(preset?.prompt).toContain("Avoid compression artifacts");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "2000s-point-and-shoot",
    );
  });

  test("includes a disposable camera style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "disposable-camera",
    );

    expect(preset?.name).toBe("Disposable camera");
    expect(preset?.prompt).toContain("single-use 35mm color");
    expect(preset?.prompt).toContain("Fixed-focus plastic lens");
    expect(preset?.prompt).toContain("built-in flash");
    expect(preset?.prompt).toContain("drugstore photo");
    expect(preset?.prompt).toContain("avoid low resolution");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "disposable-camera",
    );
  });

  test("includes an instant film style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "instant-film",
    );

    expect(preset?.name).toBe("Instant film");
    expect(preset?.prompt).toContain("fresh instant film photograph");
    expect(preset?.prompt).toContain("Polaroid or Instax color film");
    expect(preset?.prompt).toContain("Soft contrast");
    expect(preset?.prompt).toContain("adding a white instant-film border");
    expect(preset?.prompt).toContain("Avoid low resolution");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "instant-film",
    );
  });

  test("includes a candid street photography style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "candid-street-photo",
    );

    expect(preset?.name).toBe("Candid street photo");
    expect(preset?.prompt).toContain("Candid documentary street photograph");
    expect(preset?.prompt).toContain("unposed real-life moment");
    expect(preset?.prompt).toContain("available light");
    expect(preset?.prompt).toContain("avoid studio lighting");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "candid-street-photo",
    );
  });

  test("includes a nightlife party photography style preset", () => {
    const preset = GENERATED_IMAGE_STYLE_PRESETS.find(
      (option) => option.id === "nightlife-party-photo",
    );

    expect(preset?.name).toBe("Nightlife party photo");
    expect(preset?.prompt).toContain("Candid nightlife and party photograph");
    expect(preset?.prompt).toContain("direct on-camera flash");
    expect(preset?.prompt).toContain("saturated practical lights or neon");
    expect(preset?.prompt).toContain("avoid fashion editorial posing");
    expect(detectGeneratedImageStylePreset(preset?.prompt ?? "")).toBe(
      "nightlife-party-photo",
    );
  });

  test("builds separated style, subject, and avoid sections in that order", () => {
    const prompt = buildGeneratedImageProviderPrompt({
      prompt: "A brass key on a rain-dark windowsill.",
      stylePrompt: "Cinematic light, shallow depth of field.",
    });

    expect(prompt).toContain("Photographic style:\nCinematic light");
    expect(prompt).toContain("Subject:\nA brass key");
    expect(prompt).toContain(`Avoid:\n${PHOTOREALISM_NEGATIVE_PROMPT}`);
    expect(prompt.indexOf("Photographic style:")).toBeLessThan(
      prompt.indexOf("Subject:"),
    );
    expect(prompt.indexOf("Subject:")).toBeLessThan(prompt.indexOf("Avoid:"));
  });

  test("flags only diffusion models as preferring affirmative prompts", () => {
    expect(
      generatedImageModelPrefersAffirmativePrompt(
        "bytedance/seedream-v5.0-pro",
      ),
    ).toBe(true);
    expect(
      generatedImageModelPrefersAffirmativePrompt("krea/krea-2-medium"),
    ).toBe(true);
    expect(
      generatedImageModelPrefersAffirmativePrompt(
        "microsoft/mai-image-2.5-pro",
      ),
    ).toBe(true);
    expect(
      generatedImageModelPrefersAffirmativePrompt(
        "alibaba/qwen-image-3.0/text-to-image",
      ),
    ).toBe(true);
    expect(
      generatedImageModelPrefersAffirmativePrompt(
        "alibaba/qwen-image-3.0-pro/text-to-image",
      ),
    ).toBe(true);
    expect(
      generatedImageModelPrefersAffirmativePrompt(
        "openai/gpt-image-2/text-to-image",
      ),
    ).toBe(false);
    expect(
      generatedImageModelPrefersAffirmativePrompt("google/gemini-3-pro-image"),
    ).toBe(false);
  });

  test("builds a photorealism-first, negation-free prompt for Seedream models", () => {
    const prompt = buildGeneratedImageProviderPrompt({
      model: "bytedance/seedream-v5.0-pro",
      prompt: "A brass key on a rain-dark windowsill.",
      stylePrompt: "Cinematic light, shallow depth of field.",
    });

    // Photorealism anchor and subject lead the prompt; the style follows.
    expect(prompt.startsWith("Real photograph. Photorealistic")).toBe(true);
    expect(prompt.indexOf("Subject:")).toBeLessThan(
      prompt.indexOf("Photographic style:"),
    );
    expect(prompt).toContain(PHOTOREALISM_AFFIRMATIVE_PROMPT);
    // No "Avoid:" list and no forbidden-style names that would backfire.
    expect(prompt).not.toContain("Avoid:");
    expect(prompt).not.toContain(PHOTOREALISM_NEGATIVE_PROMPT);
    expect(prompt).not.toContain("anime");
    expect(prompt).not.toContain("illustration");
  });

  test("builds an affirmation-only system instruction for Seedream models", () => {
    const instructions = buildGeneratedImageSystemInstruction(
      "bytedance/seedream-v5.0-pro",
    );

    expect(instructions).toContain(
      "Generate exactly one photorealistic image.",
    );
    expect(instructions).toContain(PHOTOREALISM_AFFIRMATIVE_PROMPT);
    // The negation-based instruction that diffusion models misread is omitted.
    expect(instructions).not.toContain("Do not produce illustrations");
    expect(instructions).not.toContain("anime");
  });

  test("falls back to a neutral photographic style when none is given", () => {
    const prompt = buildGeneratedImageProviderPrompt({
      prompt: "A weathered fishing dock at dawn.",
      stylePrompt: "   ",
    });

    expect(prompt).toContain("Unstyled documentary photograph");
  });

  test("builds image-only and photorealism system instructions", () => {
    const instructions = buildGeneratedImageSystemInstruction();

    for (const instruction of IMAGE_ONLY_INSTRUCTIONS) {
      expect(instructions).toContain(instruction);
    }

    for (const instruction of PHOTOREALISM_INSTRUCTIONS) {
      expect(instructions).toContain(instruction);
    }

    expect(instructions).toContain("Generate exactly one image.");
    expect(instructions).toContain("Every output is a real photograph.");
  });

  test("uses the supported image model option set", () => {
    expect(GENERATED_IMAGE_MODELS).toEqual([
      {
        id: "openai/gpt-image-2/text-to-image",
        name: "GPT Image 2",
        outputModalities: ["image"],
        provider: "wavespeed",
        providerModelId: "openai/gpt-image-2/text-to-image",
      },
      {
        id: "google/gemini-3-pro-image",
        name: "Nano Banana Pro",
        outputModalities: ["image", "text"],
        provider: "openrouter",
        providerModelId: "google/gemini-3-pro-image",
      },
      {
        id: "google/gemini-3.1-flash-image",
        name: "Nano Banana 2",
        outputModalities: ["image", "text"],
        provider: "openrouter",
        providerModelId: "google/gemini-3.1-flash-image",
      },
      {
        id: "bytedance/seedream-v5.0-pro",
        name: "Seedream 5 Pro",
        outputModalities: ["image"],
        provider: "wavespeed",
        providerModelId: "bytedance/seedream-v5.0-pro",
      },
      {
        id: "microsoft/mai-image-2.5-pro",
        name: "MAI-Image-2.5 Pro",
        outputModalities: ["image"],
        provider: "openrouter",
        providerModelId: "microsoft/mai-image-2.5-pro",
      },
      {
        id: "krea/krea-2-medium",
        name: "Krea 2 Medium",
        outputModalities: ["image"],
        provider: "openrouter",
        providerModelId: "krea/krea-2-medium",
      },
      {
        id: "alibaba/qwen-image-3.0-pro/text-to-image",
        name: "Qwen Image 3.0 Pro",
        outputModalities: ["image"],
        provider: "wavespeed",
        providerModelId: "alibaba/qwen-image-3.0-pro/text-to-image",
      },
      {
        id: "alibaba/qwen-image-3.0/text-to-image",
        name: "Qwen Image 3.0",
        outputModalities: ["image"],
        provider: "wavespeed",
        providerModelId: "alibaba/qwen-image-3.0/text-to-image",
      },
    ]);
    expect(GENERATED_IMAGE_ASPECT_RATIOS).toEqual([
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
    ]);
    expect(GENERATED_IMAGE_SIZES).toEqual(["1K", "2K", "4K"]);
  });

  test("uses OpenRouter output modalities by model capability", () => {
    expect(
      getGeneratedImageOutputModalities("google/gemini-3-pro-image"),
    ).toEqual(["image", "text"]);
    expect(getGeneratedImageOutputModalities("krea/krea-2-medium")).toEqual([
      "image",
    ]);
    expect(
      getGeneratedImageOutputModalities("microsoft/mai-image-2.5-pro"),
    ).toEqual(["image"]);
  });

  test("routes native OpenRouter image models to the images endpoint", () => {
    // Krea is a native image-generation model: OpenRouter rejects it on
    // chat/completions with a 404 telling you to use /api/v1/images.
    expect(
      generatedImageModelUsesOpenRouterImagesEndpoint("krea/krea-2-medium"),
    ).toBe(true);
    // MAI-Image-2.5 Pro is served as a chat model and works on chat/completions.
    expect(
      generatedImageModelUsesOpenRouterImagesEndpoint(
        "microsoft/mai-image-2.5-pro",
      ),
    ).toBe(false);
    expect(
      generatedImageModelUsesOpenRouterImagesEndpoint(
        "google/gemini-3-pro-image",
      ),
    ).toBe(false);
  });

  test("keeps prompt-capped models inside their provider prompt limit", () => {
    const model = "alibaba/qwen-image-3.0/text-to-image";
    const promptLimit = getGeneratedImageModelPromptLimit(model);

    expect(promptLimit).toBe(800);
    expect(
      getGeneratedImageModelPromptLimit("bytedance/seedream-v5.0-pro"),
    ).toBe(null);

    const prompt = buildGeneratedImageProviderPrompt({
      model,
      // Both sections run far past the cap on their own.
      prompt: "A courier waits under green ferry-terminal lights. ".repeat(30),
      stylePrompt: getGeneratedImageStylePresetPrompt("amateur-photo"),
    });

    expect(prompt.length).toBeLessThanOrEqual(promptLimit ?? 0);
    expect(prompt.startsWith("Real photograph")).toBe(true);
    expect(prompt).toContain("Subject:\nA courier waits");
    expect(prompt).toContain("Style:");
    expect(prompt).toContain(PHOTOREALISM_AFFIRMATIVE_PROMPT_COMPACT);
    // The capped prompt stays affirmation-only, like the other diffusion models.
    expect(prompt).not.toContain("Avoid:");
    expect(prompt).not.toContain("anime");

    // A short description keeps its full text and leaves the rest to the style.
    const shortPrompt = buildGeneratedImageProviderPrompt({
      model,
      prompt: "A brass key on a rain-dark windowsill.",
      stylePrompt: getGeneratedImageStylePresetPrompt("amateur-photo"),
    });

    expect(shortPrompt.length).toBeLessThanOrEqual(promptLimit ?? 0);
    expect(shortPrompt).toContain(
      "Subject:\nA brass key on a rain-dark windowsill.",
    );
  });

  test("reserves an image description budget for prompt-capped models", () => {
    const subjectLimit = getGeneratedImageModelSubjectLimit(
      "alibaba/qwen-image-3.0-pro/text-to-image",
    );

    expect(subjectLimit).not.toBeNull();
    expect(subjectLimit ?? 0).toBeGreaterThan(0);
    expect(subjectLimit ?? 0).toBeLessThan(800);
    expect(
      getGeneratedImageModelSubjectLimit("openai/gpt-image-2/text-to-image"),
    ).toBe(null);
  });

  test("normalizes legacy generated image options for new requests", () => {
    expect(normalizeGeneratedImageModel("google/gemini-2.5-flash-image")).toBe(
      "google/gemini-3-pro-image",
    );
    expect(normalizeGeneratedImageModel("unknown-image-model")).toBe(
      "openai/gpt-image-2/text-to-image",
    );
    expect(normalizeGeneratedImageAspectRatio("1:8")).toBe("1:1");
    expect(normalizeGeneratedImageSize("0.5K")).toBe("1K");
  });

  test("builds generated image download names and URLs", () => {
    expect(
      getGeneratedImageDownloadFilename({
        id: "generated-image_abc/123",
        mimeType: "image/jpeg",
      }),
    ).toBe("localink-image-generated-image_abc-123.jpg");
    expect(
      getGeneratedImageDownloadFilename({
        id: "",
        mimeType: "image/unknown",
      }),
    ).toBe("localink-image-generated-image.png");
    expect(
      getGeneratedImageDownloadUrl("/api/generated-images/one/content"),
    ).toBe("/api/generated-images/one/content?download=1");
    expect(
      getGeneratedImageDownloadUrl("/api/generated-images/one/content?size=1"),
    ).toBe("/api/generated-images/one/content?size=1&download=1");
  });
});
