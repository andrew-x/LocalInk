// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";

import {
  enhanceImagePromptActionSchema,
  generateImageActionSchema,
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

  test("reads the WaveSpeed base64 output format from the payload itself", async () => {
    const { detectWaveSpeedBase64MimeType } = await import(
      "./generated-images"
    );
    const toBase64 = (header: number[]) =>
      Buffer.concat([Buffer.from(header), Buffer.alloc(32)]).toString("base64");

    // Only models that declare `output_format` are told to render PNG. Grok 2
    // Image always answers with JPEG, and mislabelling it would store the wrong
    // extension and `mime_type` for the row.
    expect(detectWaveSpeedBase64MimeType(toBase64([0xff, 0xd8, 0xff]))).toBe(
      "image/jpeg",
    );
    expect(
      detectWaveSpeedBase64MimeType(
        toBase64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    // Providers may wrap long base64 payloads, so whitespace in the header must
    // not defeat the check.
    expect(
      detectWaveSpeedBase64MimeType(
        `\n${toBase64([0xff, 0xd8, 0xff]).slice(0, 8)}\n${toBase64([
          0xff, 0xd8, 0xff,
        ]).slice(8)}`,
      ),
    ).toBe("image/jpeg");
    // An unrecognized header keeps the previous assumption rather than failing;
    // the full payload is validated downstream.
    expect(detectWaveSpeedBase64MimeType("AAAA")).toBe("image/png");
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

    expect(parsed.model).toBe("openai/gpt-image-2");
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

  test("carries an optional enhanced description on generation only", () => {
    const withEnhancement = generateImageActionSchema.parse({
      enhancedPrompt: "A small blue door set into weathered red brick.",
      prompt: "A small blue door in a brick wall.",
      stylePrompt: "Natural light.",
    });

    expect(withEnhancement.prompt).toBe("A small blue door in a brick wall.");
    expect(withEnhancement.enhancedPrompt).toBe(
      "A small blue door set into weathered red brick.",
    );

    expect(
      generateImageActionSchema.parse({
        prompt: "A small blue door in a brick wall.",
        stylePrompt: "Natural light.",
      }).enhancedPrompt,
    ).toBeUndefined();

    // Enhancement produces the enhanced description, so its own input drops one.
    expect(
      enhanceImagePromptActionSchema.parse({
        enhancedPrompt: "Already enhanced.",
        prompt: "A small blue door in a brick wall.",
        stylePrompt: "Natural light.",
      }),
    ).not.toHaveProperty("enhancedPrompt");
  });

  test("keeps the user's wording beside the description that is sent", async () => {
    const { resolveGeneratedImagePrompts } = await import(
      "@/lib/server/generated-images"
    );

    expect(
      resolveGeneratedImagePrompts({
        enhancedPrompt: "  A small blue door set into weathered red brick.  ",
        prompt: "  A small blue door in a brick wall.  ",
      }),
    ).toEqual({
      originalPrompt: "A small blue door in a brick wall.",
      prompt: "A small blue door set into weathered red brick.",
    });

    // No enhancement, a blank one, or one that came back unchanged all mean the
    // stored prompt is already the user's own text.
    for (const enhancedPrompt of [undefined, "   ", "A small blue door."]) {
      expect(
        resolveGeneratedImagePrompts({
          enhancedPrompt,
          prompt: "A small blue door.",
        }),
      ).toEqual({ originalPrompt: null, prompt: "A small blue door." });
    }
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
      model: "google/gemini-3-pro-image",
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
      model: "openai/gpt-image-2",
      prompt: "A brass key on a rain-dark windowsill.",
      stylePreset: "amateur-photo",
      stylePrompt: "Natural light.",
    });

    expect(parsed.prompt).toBe("A brass key on a rain-dark windowsill.");

    expect(
      enhanceImagePromptActionSchema.safeParse({
        aspectRatio: "4:3",
        imageSize: "1K",
        model: "openai/gpt-image-2",
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
    // Qwen tops out below 4K, so the requested size is clamped down.
    expect(qwenBody.resolution).toBe("2k");
    expect(qwenBody.aspect_ratio).toBe("16:9");
    // Diffusion models skip the negation-based system instruction entirely, so
    // the composed provider prompt is sent through untouched.
    expect(qwenBody.prompt).toBe("A brass key on a rain-dark windowsill.");

    expect(
      Object.keys(buildBody("alibaba/qwen-image-3.0-pro/text-to-image")),
    ).toEqual(Object.keys(qwenBody));

    // Grok 2 Image declares no `aspect_ratio` and no `resolution`, so both are
    // dropped rather than clamped; it sizes every output itself.
    const grokBody = buildBody("x-ai/grok-2-image");

    expect(Object.keys(grokBody).sort()).toEqual([
      "enable_base64_output",
      "enable_sync_mode",
      "prompt",
    ]);
    expect(grokBody.enable_base64_output).toBe(true);
    expect(grokBody.enable_sync_mode).toBe(false);
    // Its prompt cap is smaller than the negation-based system instruction, so
    // the composed provider prompt is sent through untouched.
    expect(grokBody.prompt).toBe("A brass key on a rain-dark windowsill.");

    // Models without a capability entry fall back to the conservative defaults:
    // base64 output and sync mode, no quality, no prompt expansion, 2K at most.
    const fallbackBody = buildBody("google/gemini-3-pro-image");

    expect(fallbackBody.enable_base64_output).toBe(true);
    expect(fallbackBody.enable_sync_mode).toBe(false);
    expect(fallbackBody.output_format).toBe("png");
    expect(fallbackBody.resolution).toBe("2k");
    expect(fallbackBody.quality).toBeUndefined();
    expect(fallbackBody.enable_prompt_expansion).toBeUndefined();
  });

  test("sends each OpenRouter images model only the fields it declares", async () => {
    const { buildOpenRouterImagesRequestBody } = await import(
      "./generated-images"
    );
    const { getGeneratedImageModelConfig } = await import(
      "@/lib/generated-images"
    );
    const buildBody = (
      model: Parameters<typeof getGeneratedImageModelConfig>[0],
    ) =>
      buildOpenRouterImagesRequestBody({
        aspectRatio: "5:4",
        imageSize: "4K",
        modelConfig: getGeneratedImageModelConfig(model),
        providerPrompt: "A brass key on a rain-dark windowsill.",
      });

    // GPT Image 2 declares no `resolution` at all, so the field is dropped
    // rather than clamped, and it is the one images-endpoint model that takes
    // `quality`. It is instruction-tuned, so it still gets the image-only
    // system instruction folded into the single prompt string.
    const gptImageBody = buildBody("openai/gpt-image-2");

    expect(Object.keys(gptImageBody).sort()).toEqual([
      "aspect_ratio",
      "model",
      "prompt",
      "quality",
    ]);
    expect(gptImageBody.quality).toBe("medium");
    expect(gptImageBody.model).toBe("openai/gpt-image-2");
    expect(String(gptImageBody.prompt)).toContain(
      "Generate exactly one image.",
    );

    // Seedream tops out at 2K and takes no quality; diffusion models send the
    // composed provider prompt untouched.
    const seedreamBody = buildBody("bytedance-seed/seedream-5-0-pro");

    expect(Object.keys(seedreamBody).sort()).toEqual([
      "aspect_ratio",
      "model",
      "prompt",
      "resolution",
    ]);
    expect(seedreamBody.resolution).toBe("2K");
    expect(seedreamBody.aspect_ratio).toBe("5:4");
    expect(seedreamBody.prompt).toBe("A brass key on a rain-dark windowsill.");

    // Krea only ever renders 1K and has no 5:4.
    const kreaBody = buildBody("krea/krea-2-large");

    expect(kreaBody.resolution).toBe("1K");
    expect(kreaBody.aspect_ratio).toBe("4:3");
  });

  test("clamps OpenRouter images requests to each model's supported enums", async () => {
    const { clampOpenRouterImagesAspectRatio, clampOpenRouterImagesSize } =
      await import("./generated-images");

    // Seedream tops out at 2K; Krea only ever renders 1K; GPT Image 2 has no
    // `resolution` parameter at all, so the field is dropped.
    expect(
      clampOpenRouterImagesSize({
        imageSize: "4K",
        model: "bytedance-seed/seedream-5-0-pro",
      }),
    ).toBe("2K");
    expect(
      clampOpenRouterImagesSize({
        imageSize: "2K",
        model: "krea/krea-2-large",
      }),
    ).toBe("1K");
    expect(
      clampOpenRouterImagesSize({
        imageSize: "1K",
        model: "bytedance-seed/seedream-5-0-pro",
      }),
    ).toBe("1K");
    expect(
      clampOpenRouterImagesSize({
        imageSize: "4K",
        model: "openai/gpt-image-2",
      }),
    ).toBe(null);
    // Chat-style models have no capability entry, so nothing is clamped.
    expect(
      clampOpenRouterImagesSize({
        imageSize: "4K",
        model: "google/gemini-3-pro-image",
      }),
    ).toBe("4K");

    // Supported ratios pass through untouched.
    expect(
      clampOpenRouterImagesAspectRatio({
        aspectRatio: "21:9",
        model: "bytedance-seed/seedream-5-0-pro",
      }),
    ).toBe("21:9");
    // GPT Image 2 has no 5:4, and Krea has neither 5:4 nor 3:4, so each falls
    // back to the closest shape it does support.
    expect(
      clampOpenRouterImagesAspectRatio({
        aspectRatio: "5:4",
        model: "openai/gpt-image-2",
      }),
    ).toBe("4:3");
    expect(
      clampOpenRouterImagesAspectRatio({
        aspectRatio: "5:4",
        model: "krea/krea-2-large",
      }),
    ).toBe("4:3");
    expect(
      clampOpenRouterImagesAspectRatio({
        aspectRatio: "3:4",
        model: "krea/krea-2-large",
      }),
    ).toBe("4:5");
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
    expect(getEnhancedGeneratedImagePromptLimit("openai/gpt-image-2")).toBe(
      4000,
    );

    // Grok 2 Image caps prompts around 1,000 characters, so the composed
    // provider prompt has to fit even when the description and style direction
    // are both far longer than the budget.
    const { buildGeneratedImageProviderPrompt } = await import(
      "@/lib/generated-images"
    );
    const grokLimit = getEnhancedGeneratedImagePromptLimit("x-ai/grok-2-image");

    expect(grokLimit).toBeGreaterThan(0);
    expect(grokLimit).toBeLessThan(1000);
    expect(
      buildGeneratedImageProviderPrompt({
        model: "x-ai/grok-2-image",
        prompt: "A courier waits under ferry lights. ".repeat(40),
        stylePrompt: "Candid documentary street photograph. ".repeat(20),
      }).length,
    ).toBeLessThanOrEqual(1000);

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

  test("summarizes provider error bodies without leaking prompt text", async () => {
    const { summarizeProviderErrorBody } = await import("./generated-images");

    // OpenRouter nests the failure under `error`; the message is the part that
    // actually explains a 4xx, so it has to survive.
    expect(
      summarizeProviderErrorBody(
        JSON.stringify({
          error: {
            code: 402,
            message: "Insufficient credits.",
            metadata: { provider_name: "Google AI Studio" },
          },
        }),
      ),
    ).toEqual({
      providerErrorCode: "402",
      providerErrorMessage: "Insufficient credits.",
      providerName: "Google AI Studio",
    });

    // WaveSpeed reports at the top level instead.
    expect(
      summarizeProviderErrorBody(
        JSON.stringify({ code: 400, message: "resolution not supported" }),
      ),
    ).toEqual({
      providerErrorCode: "400",
      providerErrorMessage: "resolution not supported",
      providerName: undefined,
    });

    // A moderation message quotes the prompt back, so only the fact of the
    // rejection may reach the logs.
    const moderated = summarizeProviderErrorBody(
      JSON.stringify({
        error: {
          code: "moderation",
          message:
            'Blocked by content policy: "a girl in the rain" violates the rules.',
        },
      }),
    );

    expect(moderated.providerErrorMessage).toBe(
      "[content-rejection text withheld]",
    );
    expect(moderated.providerErrorMessage).not.toContain("girl in the rain");

    // Nested objects must not smuggle payload data through an enum-ish field.
    expect(
      summarizeProviderErrorBody(
        JSON.stringify({ error: { code: { nested: "value" }, message: 12 } }),
      ),
    ).toEqual({
      providerErrorCode: undefined,
      providerErrorMessage: undefined,
      providerName: undefined,
    });

    // Gateways answer with HTML, which still carries the useful part.
    expect(
      summarizeProviderErrorBody("<html><body>502 Bad Gateway</body></html>")
        .providerErrorMessage,
    ).toBe("<html><body>502 Bad Gateway</body></html>");

    const long = summarizeProviderErrorBody(
      JSON.stringify({ error: { message: "upstream failure. ".repeat(40) } }),
    ).providerErrorMessage;

    expect(long?.length).toBeLessThanOrEqual(201);
    expect(long?.endsWith("…")).toBe(true);

    expect(summarizeProviderErrorBody(null)).toEqual({});
    expect(summarizeProviderErrorBody("   ")).toEqual({});
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
