// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";

import {
  enhanceImagePromptActionSchema,
  generateImageFormSchema,
} from "@/actions/generated-images/_schemas";
import { ActionError } from "@/lib/action-error";

mock.module("server-only", () => ({}));

describe("generated image server helpers", () => {
  test("parses OpenRouter image data URLs and fails text-only responses", async () => {
    const { parseOpenRouterGeneratedImageDataUrl } = await import(
      "./generated-images"
    );
    const dataUrl = "data:image/png;base64,AAAA";

    expect(
      parseOpenRouterGeneratedImageDataUrl({
        choices: [
          {
            message: {
              images: [
                {
                  image_url: {
                    url: dataUrl,
                  },
                },
              ],
            },
          },
        ],
        id: "gen_123",
      }),
    ).toEqual({
      dataUrl,
      id: "gen_123",
    });

    expectActionError(
      () =>
        parseOpenRouterGeneratedImageDataUrl({
          choices: [
            {
              message: {
                images: [],
              },
            },
          ],
        }),
      "GENERATION_FAILED",
    );
  });

  test("parses WaveSpeed base64 outputs and fails incomplete responses", async () => {
    const { parseWaveSpeedGeneratedImageBase64 } = await import(
      "./generated-images"
    );

    expect(
      parseWaveSpeedGeneratedImageBase64({
        data: {
          id: "pred_123",
          outputs: ["AAAA"],
          status: "completed",
        },
      }),
    ).toEqual({
      base64: "AAAA",
      id: "pred_123",
    });

    expectActionError(
      () =>
        parseWaveSpeedGeneratedImageBase64({
          data: {
            outputs: [],
            status: "completed",
          },
        }),
      "GENERATION_FAILED",
    );
    expectActionError(
      () =>
        parseWaveSpeedGeneratedImageBase64({
          data: {
            error: "provider error",
            status: "failed",
          },
        }),
      "GENERATION_FAILED",
    );
    expectActionError(
      () =>
        parseWaveSpeedGeneratedImageBase64({
          data: {
            id: "pred_123",
            status: "processing",
          },
        }),
      "GENERATION_FAILED",
    );
  });

  test("decodes image base64 and data URLs, then reads PNG dimensions", async () => {
    const { decodeGeneratedImageBase64, decodeGeneratedImageDataUrl } =
      await import("./generated-images");
    const png = Buffer.alloc(24);

    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(180, 20);

    const decoded = decodeGeneratedImageDataUrl(
      `data:image/png;base64,${png.toString("base64")}`,
    );

    expect(decoded.mimeType).toBe("image/png");
    expect(decoded.extension).toBe("png");
    expect(decoded.width).toBe(320);
    expect(decoded.height).toBe(180);
    expect(decoded.bytes.byteLength).toBe(png.byteLength);

    const decodedBase64 = decodeGeneratedImageBase64(
      png.toString("base64"),
      "image/png",
    );

    expect(decodedBase64.width).toBe(320);
    expect(decodedBase64.height).toBe(180);
    expect(decodedBase64.bytes.byteLength).toBe(png.byteLength);
  });

  test("rejects non-image data URLs and malformed image base64", async () => {
    const { decodeGeneratedImageBase64, decodeGeneratedImageDataUrl } =
      await import("./generated-images");

    expectActionError(
      () => decodeGeneratedImageDataUrl("data:text/plain;base64,SGVsbG8="),
      "GENERATION_FAILED",
    );
    expectActionError(
      () => decodeGeneratedImageDataUrl("not a data url"),
      "GENERATION_FAILED",
    );
    expectActionError(
      () =>
        decodeGeneratedImageBase64(
          "https://example.com/generated-image.png",
          "image/png",
        ),
      "GENERATION_FAILED",
    );
  });

  test("keeps generated image paths inside the local data directory", async () => {
    const { resolveGeneratedImageFilePath } = await import(
      "./generated-images"
    );
    const rootDirectory = "/tmp/localink-path-test";

    expect(
      resolveGeneratedImageFilePath(
        "generated-images/image-1.png",
        "dev",
        rootDirectory,
      ),
    ).toBe("/tmp/localink-path-test/data/dev/generated-images/image-1.png");

    expectActionError(
      () =>
        resolveGeneratedImageFilePath(
          "generated-images/../localink.sqlite",
          "dev",
          rootDirectory,
        ),
      "BAD_REQUEST",
    );
    expectActionError(
      () =>
        resolveGeneratedImageFilePath("/tmp/outside.png", "dev", rootDirectory),
      "BAD_REQUEST",
    );
  });

  test("validates image generation action input", () => {
    const parsed = generateImageFormSchema.parse({
      prompt: "A small blue door in a brick wall.",
      stylePrompt: "Natural light.",
    });

    expect(parsed.model).toBe("openai/gpt-image-2/text-to-image");
    expect(parsed.aspectRatio).toBe("1:1");
    expect(parsed.imageSize).toBe("1K");
    expect(parsed.stylePreset).toBe("amateur-photo");

    expect(
      generateImageFormSchema.safeParse({
        prompt: "",
        stylePrompt: "Natural light.",
      }).success,
    ).toBe(false);
  });

  test("builds prompt enhancement context around the final image prompt shape", async () => {
    const {
      buildGeneratedImagePromptEnhancementRequest,
      buildGeneratedImagePromptEnhancementSystemPrompt,
    } = await import("./generated-images");

    const systemPrompt = buildGeneratedImagePromptEnhancementSystemPrompt();
    const requestPrompt = buildGeneratedImagePromptEnhancementRequest({
      aspectRatio: "16:9",
      imageSize: "2K",
      model: "google/gemini-3-pro-image-preview",
      prompt: "A tired courier at a neon ferry terminal.",
      providerPromptTemplate:
        "Photographic style:\nCinematic\n\nSubject:\n<ENHANCED_IMAGE_DESCRIPTION>\n\nAvoid:\nplastic skin",
      stylePreset: "custom",
      stylePrompt: "Cinematic rain, shallow focus.",
      systemInstruction: "Generate exactly one image.",
    });

    expect(systemPrompt).toContain(
      "Return only the enhanced image description",
    );
    expect(systemPrompt).toContain("photographic style");
    expect(requestPrompt).toContain("<ENHANCED_IMAGE_DESCRIPTION>");
    expect(requestPrompt).toContain("A tired courier at a neon ferry terminal");
    expect(requestPrompt).toContain("Nano Banana Pro");
    expect(requestPrompt).toContain('"aspectRatio": "16:9"');
  });

  test("normalizes enhanced prompt text from common model wrappers", async () => {
    const { normalizeEnhancedGeneratedImagePrompt } = await import(
      "./generated-images"
    );

    expect(
      normalizeEnhancedGeneratedImagePrompt(
        "Enhanced image description: ```text\nA courier waits under green ferry-terminal lights.\n```",
      ),
    ).toBe("A courier waits under green ferry-terminal lights.");
    expect(
      normalizeEnhancedGeneratedImagePrompt(
        "Subject: A courier waits under green ferry-terminal lights.",
      ),
    ).toBe("A courier waits under green ferry-terminal lights.");
    expectActionError(
      () => normalizeEnhancedGeneratedImagePrompt("   "),
      "GENERATION_FAILED",
    );
  });

  test("validates image prompt enhancement action input", () => {
    const parsed = enhanceImagePromptActionSchema.parse({
      aspectRatio: "4:3",
      imageSize: "1K",
      model: "openai/gpt-image-2/text-to-image",
      prompt: "A brass key on a rain-dark windowsill.",
      stylePreset: "amateur-photo",
      stylePrompt: "Natural light.",
    });

    expect(parsed.prompt).toBe("A brass key on a rain-dark windowsill.");

    expect(
      enhanceImagePromptActionSchema.safeParse({
        aspectRatio: "4:3",
        imageSize: "1K",
        model: "openai/gpt-image-2/text-to-image",
        prompt: "",
        stylePreset: "amateur-photo",
        stylePrompt: "Natural light.",
      }).success,
    ).toBe(false);
  });
});

function expectActionError(
  fn: () => unknown,
  code: InstanceType<typeof ActionError>["code"],
) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe(code);
    return;
  }

  throw new Error("Expected ActionError to be thrown.");
}
