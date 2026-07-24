# AI Image Generation

LocalInk can generate reference images through server-side image providers while keeping generated assets in the local data folder.

## Provider Flow

GPT Image 2 and Seedream 5 Pro generations post to WaveSpeed's `/api/v3/{providerModelId}` endpoint (e.g. `/api/v3/openai/gpt-image-2/text-to-image`, `/api/v3/bytedance/seedream-v5.0-pro`) from server-only code. The request body is built per model from a `WAVESPEED_MODEL_CAPABILITIES` map in `src/lib/server/generated-images.ts` (keyed by `providerModelId`), since WaveSpeed models vary in max resolution and supported fields:

- GPT Image 2 (`openai/gpt-image-2/text-to-image`): supports up to `4k` and sends a `quality: "medium"` field.
- Seedream 5 Pro (`bytedance/seedream-v5.0-pro`): tops out at `2k` and does not send `quality`. If the app's `4K` size is selected, it is clamped down to `2k` for this model.

All WaveSpeed requests include the combined image-only, photorealism, style, and subject prompt plus `aspect_ratio`, `resolution`, `output_format: "png"`, `enable_sync_mode: false`, and `enable_base64_output: true`.

WaveSpeed returns a prediction ID first. LocalInk polls the provider result URL until the prediction is `completed`, decodes the returned base64 PNG, and writes the bytes into the local generated-images directory.

Nano Banana Pro, Nano Banana 2, and Seedream 4.5 generations post to OpenRouter's `/api/v1/chat/completions` endpoint from server-only code. Requests use the selected model's output modalities, an image-only system instruction, and `image_config` values for aspect ratio and image size. Text-plus-image models use `modalities: ["image", "text"]`; image-only models use `modalities: ["image"]`. OpenRouter returns generated images as base64 data URLs in `choices[0].message.images`.

Note: "Seedream 4.5" (`bytedance-seed/seedream-4.5`) and "Seedream 5 Pro" (`bytedance/seedream-v5.0-pro`) are distinct registry entries with different providers — 4.5 runs through OpenRouter, 5 Pro runs through WaveSpeed. Do not conflate them.

The provider prompt combines the user's image description with the selected style direction. Built-in style presets are photographic, and custom style text is stored as the style direction for that generation.

The `/images/generate` workspace can enhance the image description before generation. Enhancement uses the app's main DeepSeek V4 text model through OpenRouter and returns an alternate image-description value. The workspace keeps the user's original input in the text field, shows the enhanced version below it, and lets the user choose which description to send for generation. The enhancement prompt includes the selected style direction, image model, aspect ratio, size, image-only system instruction, and final provider prompt template so the rewrite is optimized for the same prompt structure LocalInk will send to the image provider.

Image provider configuration comes from environment variables:

- `WAVESPEED_API_KEY`: required for GPT Image 2 and Seedream 5 Pro generation.
- `OPENROUTER_API_KEY`: required for Nano Banana Pro, Nano Banana 2, Seedream 4.5 generation, and image-description enhancement.
- `OPENROUTER_APP_NAME`: optional `X-Title` header value.
- `OPENROUTER_APP_URL`: optional `HTTP-Referer` header value.

## Local Storage

Generated image metadata is stored in the `generated_images` SQLite table. The binary image file is stored under the active data mode:

- `data/dev/generated-images/`
- `data/prod/generated-images/`

The database row stores only metadata and a relative file path. Server-side file resolution rejects absolute paths, parent-directory traversal, and paths outside the generated-images directory before reading or deleting files.

## User-Facing Workflow

Generated image actions live under `src/actions/generated-images/`. Reads use logged Server Functions and mutations use `publicActionClient` metadata, following `docs/backend-actions.md`.

Current routes:

- `/images/generate`: image generation workspace.
- `/images`: generated image gallery.
- `/images/[imageId]`: generated image detail.
- `/api/generated-images/[imageId]/content`: local image content response by generated image ID.

## Logging And Privacy

Generated image prompts and image bytes are private user data. Do not log prompt text, provider prompt bodies, base64 image data, binary image contents, local filesystem paths, raw action payloads, or provider response bodies that may contain image data.

Logs may include sanitized operational metadata such as action names, generated image IDs, counts, durations, success state, and sanitized error codes.
