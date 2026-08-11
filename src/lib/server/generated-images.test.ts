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

  test("separates WaveSpeed content rejections from provider failures", async () => {
    const {
      classifyWaveSpeedFailureReason,
      parseWaveSpeedGeneratedImageBase64,
    } = await import("./generated-images");

    expect(
      classifyWaveSpeedFailureReason({
        error: "Request blocked by content policy.",
      }),
    ).toBe("content-rejected");
    expect(
      classifyWaveSpeedFailureReason({
        error: { message: "NSFW content detected in the output." },
      }),
    ).toBe("content-rejected");
    expect(classifyWaveSpeedFailureReason({ error: "upstream timeout" })).toBe(
      "provider-error",
    );
    expect(classifyWaveSpeedFailureReason({})).toBe("provider-error");

    // A censored generation must be distinguishable from an outage, otherwise
    // there is no hint that rephrasing the prompt would help.
    try {
      parseWaveSpeedGeneratedImageBase64({
        data: {
          error: "The prompt violates our content policy.",
          status: "failed",
        },
      });
      throw new Error("Expected ActionError to be thrown.");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).publicMessage).toContain(
        "content filter rejected",
      );
    }
  });

  test("deletes WaveSpeed predictions without failing on provider errors", async () => {
    const { deleteWaveSpeedPrediction } = await import("./generated-images");
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.WAVESPEED_API_KEY;
    const calls: Array<{ init: RequestInit; url: string }> = [];

    process.env.WAVESPEED_API_KEY = "test-key";
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ init, url });

      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await deleteWaveSpeedPrediction("pred_123");

      expect(calls).toHaveLength(1);

      const [deleteCall] = calls;

      expect(deleteCall).toBeDefined();
      expect(deleteCall?.url).toBe(
        "https://api.wavespeed.ai/api/v3/predictions/delete",
      );
      expect(deleteCall?.init.method).toBe("POST");
      expect(deleteCall?.init.body).toBe('{"ids":["pred_123"]}');
      expect(
        (deleteCall?.init.headers as Record<string, string> | undefined)
          ?.Authorization,
      ).toBe("Bearer test-key");

      // A blank id has nothing to delete, and cleanup must stay silent rather
      // than sending a malformed request.
      await deleteWaveSpeedPrediction("   ");
      expect(calls).toHaveLength(1);

      // Cleanup runs after the image is already stored locally, so neither a
      // rejected provider response nor a network failure may throw.
      globalThis.fetch = (async () =>
        new Response(null, { status: 500 })) as unknown as typeof fetch;
      expect(await deleteWaveSpeedPrediction("pred_123")).toBeUndefined();

      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch;
      expect(await deleteWaveSpeedPrediction("pred_123")).toBeUndefined();

      delete process.env.WAVESPEED_API_KEY;
      globalThis.fetch = (async () => {
        throw new Error("fetch should not be called without an API key");
      }) as unknown as typeof fetch;
      expect(await deleteWaveSpeedPrediction("pred_123")).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;

      if (originalApiKey === undefined) {
        delete process.env.WAVESPEED_API_KEY;
      } else {
        process.env.WAVESPEED_API_KEY = originalApiKey;
      }
    }
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

  test("parses OpenRouter images-endpoint responses", async () => {
    const { parseOpenRouterImagesGeneratedImageDataUrl } = await import(
      "./generated-images"
    );

    // This endpoint returns naked base64 plus a separate media type, unlike the
    // data URLs the chat/completions path returns.
    expect(
      parseOpenRouterImagesGeneratedImageDataUrl({
        data: [{ b64_json: "AAAA", media_type: "image/png" }],
      }),
    ).toEqual({
      dataUrl: "data:image/png;base64,AAAA",
      id: null,
    });

    expectActionError(
      () => parseOpenRouterImagesGeneratedImageDataUrl({ data: [] }),
      "GENERATION_FAILED",
    );
    expectActionError(
      () =>
        parseOpenRouterImagesGeneratedImageDataUrl({
          data: [{ b64_json: "AAAA" }],
        }),
      "GENERATION_FAILED",
    );
    expectActionError(
      () =>
        parseOpenRouterImagesGeneratedImageDataUrl({
          data: [{ b64_json: "AAAA", media_type: "text/html" }],
        }),
      "GENERATION_FAILED",
    );
  });

  test("sends each WaveSpeed model only the fields its schema declares", async () => {
    const { buildWaveSpeedRequestBody } = await import("./generated-images");
    const { getGeneratedImageModelConfig } = await import(
      "@/lib/generated-images"
    );
    const buildBody = (
      model: Parameters<typeof getGeneratedImageModelConfig>[0],
    ) =>
      buildWaveSpeedRequestBody({
        aspectRatio: "16:9",
        imageSize: "4K",
        modelConfig: getGeneratedImageModelConfig(model),
        providerPrompt: "A brass key on a rain-dark windowsill.",
      });

    const gptImageBody = buildBody("openai/gpt-image-2/text-to-image");

    expect(gptImageBody.enable_base64_output).toBe(true);
    expect(gptImageBody.enable_sync_mode).toBe(false);
    expect(gptImageBody.output_format).toBe("png");
    expect(gptImageBody.quality).toBe("medium");
    expect(gptImageBody.resolution).toBe("4k");
    expect(gptImageBody.enable_prompt_expansion).toBeUndefined();

    const seedreamBody = buildBody("bytedance/seedream-v5.0-pro");

    expect(seedreamBody.enable_base64_output).toBe(true);
    // Seedream tops out below 4K, so the requested size is clamped down.
    expect(seedreamBody.resolution).toBe("2k");
    expect(seedreamBody.quality).toBeUndefined();

    // Qwen Image 3.0 declares `additionalProperties: false` and knows nothing
    // about base64 output, sync mode, output format, or quality, so sending any
    // of them would be rejected outright.
    const qwenBody = buildBody("alibaba/qwen-image-3.0/text-to-image");

    expect(Object.keys(qwenBody).sort()).toEqual([
      "aspect_ratio",
      "enable_prompt_expansion",
      "prompt",
      "resolution",
    ]);
    expect(qwenBody.enable_prompt_expansion).toBe(false);
    expect(qwenBody.resolution).toBe("2k");
    expect(qwenBody.aspect_ratio).toBe("16:9");
    // Diffusion models skip the negation-based system instruction entirely, so
    // the composed provider prompt is sent through untouched.
    expect(qwenBody.prompt).toBe("A brass key on a rain-dark windowsill.");
    expect(String(gptImageBody.prompt)).toContain(
      "Generate exactly one image.",
    );

    expect(
      Object.keys(buildBody("alibaba/qwen-image-3.0-pro/text-to-image")),
    ).toEqual(Object.keys(qwenBody));
  });

  test("detects image MIME types from downloaded bytes", async () => {
    const { detectGeneratedImageMimeType } = await import("./generated-images");
    const png = Buffer.alloc(24);

    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);

    const webp = Buffer.alloc(16);

    webp.write("RIFF", 0, "ascii");
    webp.write("WEBP", 8, "ascii");

    expect(detectGeneratedImageMimeType(png)).toBe("image/png");
    expect(detectGeneratedImageMimeType(webp)).toBe("image/webp");
    expect(
      detectGeneratedImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe("image/jpeg");
    expect(
      detectGeneratedImageMimeType(Buffer.from("GIF89a...", "ascii")),
    ).toBe("image/gif");
    // Anything that is not a supported image must not be stored as one.
    expect(detectGeneratedImageMimeType(Buffer.from("<html>", "ascii"))).toBe(
      null,
    );
    expect(detectGeneratedImageMimeType(Buffer.alloc(0))).toBe(null);
  });

  test("holds enhanced descriptions to the model's prompt budget", async () => {
    const {
      buildGeneratedImagePromptEnhancementSystemPrompt,
      getEnhancedGeneratedImagePromptLimit,
      normalizeEnhancedGeneratedImagePrompt,
    } = await import("./generated-images");

    const qwenLimit = getEnhancedGeneratedImagePromptLimit(
      "alibaba/qwen-image-3.0/text-to-image",
    );

    expect(qwenLimit).toBeGreaterThan(0);
    expect(qwenLimit).toBeLessThan(800);
    expect(
      getEnhancedGeneratedImagePromptLimit("openai/gpt-image-2/text-to-image"),
    ).toBe(4000);

    expect(
      buildGeneratedImagePromptEnhancementSystemPrompt(qwenLimit),
    ).toContain(`under ${qwenLimit.toLocaleString("en-US")} characters`);

    const longText = "A courier waits under ferry lights. ".repeat(40);
    const normalized = normalizeEnhancedGeneratedImagePrompt(
      longText,
      qwenLimit,
    );

    expect(normalized.length).toBeLessThanOrEqual(qwenLimit);
    expect(normalized.startsWith("A courier waits")).toBe(true);
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
