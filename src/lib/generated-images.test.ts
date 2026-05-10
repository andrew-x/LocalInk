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
  getGeneratedImageDefaults,
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
  getGeneratedImageOutputModalities,
  getGeneratedImageStylePresetPrompt,
  IMAGE_ONLY_INSTRUCTIONS,
  normalizeGeneratedImageAspectRatio,
  normalizeGeneratedImageModel,
  normalizeGeneratedImageSize,
  normalizeGeneratedImageStylePreset,
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
      getGeneratedImageOutputModalities("google/gemini-3-pro-image-preview"),
    ).toEqual(["image", "text"]);
    expect(
      getGeneratedImageOutputModalities("bytedance-seed/seedream-4.5"),
    ).toEqual(["image"]);
  });

  test("normalizes legacy generated image options for new requests", () => {
    expect(normalizeGeneratedImageModel("google/gemini-2.5-flash-image")).toBe(
      "google/gemini-3-pro-image-preview",
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
