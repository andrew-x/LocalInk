# AI Image Generation

LocalInk can generate reference images through server-side image providers while keeping generated assets in the local data folder.

## Provider Flow

GPT Image 2, Seedream 5 Pro, and the Qwen Image 3.0 models post to WaveSpeed's `/api/v3/{providerModelId}` endpoint (e.g. `/api/v3/openai/gpt-image-2/text-to-image`, `/api/v3/bytedance/seedream-v5.0-pro`, `/api/v3/alibaba/qwen-image-3.0/text-to-image`) from server-only code. The request body is built per model from a `WAVESPEED_MODEL_CAPABILITIES` map in `src/lib/server/generated-images.ts` (keyed by `providerModelId`), since WaveSpeed models vary in max resolution and supported fields.

Every WaveSpeed model schema sets `additionalProperties: false`, so a field a model does not declare is rejected outright rather than ignored. Each optional field is therefore gated on a capability flag, and only `aspect_ratio`, `resolution`, and the composed `prompt` go to every model:

- GPT Image 2 (`openai/gpt-image-2/text-to-image`): supports up to `4k`, and sends `quality: "medium"`, `output_format: "png"`, `enable_sync_mode: false`, and `enable_base64_output: true`.
- Seedream 5 Pro (`bytedance/seedream-v5.0-pro`): tops out at `2k` and does not send `quality`. Otherwise the same fields as GPT Image 2. If the app's `4K` size is selected, it is clamped down to `2k`.
- Qwen Image 3.0 / 3.0 Pro (`alibaba/qwen-image-3.0/text-to-image`, `alibaba/qwen-image-3.0-pro/text-to-image`): top out at `2k` and accept only `prompt`, `aspect_ratio`, `resolution`, `enable_prompt_expansion`, and `seed`. They send `enable_prompt_expansion: false` — LocalInk composes its own photorealism prompt and has a separate enhancement step, so the provider's prompt rewriter would fight it — and cannot send `output_format`, `enable_sync_mode`, or `enable_base64_output`.

WaveSpeed returns a prediction ID first. LocalInk polls the provider result URL until the prediction is `completed`, then reads the output. Models that accept `enable_base64_output` return naked base64 that is decoded as PNG. Models that do not (Qwen Image 3.0) can only return a CDN URL, so `downloadWaveSpeedGeneratedImage` fetches it over HTTPS with a timeout and a size cap, and derives the MIME type from the image's own magic bytes rather than a provider-supplied header. Either way the bytes are written into the local generated-images directory. The download happens before the prediction cleanup below, and a failed download deletes the prediction too, since nothing was stored locally.

Once a WaveSpeed image is written to disk and its metadata row is committed to SQLite, LocalInk calls `deleteWaveSpeedPrediction(predictionId)` (in `src/lib/server/generated-images.ts`) to `POST /api/v3/predictions/delete` and remove the prediction from the user's WaveSpeed account history. This is a local-first privacy measure: once the bytes and metadata are durable locally, the provider-side copy (which retains the prompt and output) is redundant. The delete only fires after both the file write and DB insert succeed, so a local-persistence failure can never lose the image. It is best-effort, time-boxed, and never throws — a non-ok response, network failure, or timeout only logs a sanitized `wavespeed-prediction-delete-failed` error and never turns a successful generation into an error. This cleanup is WaveSpeed-only (gated on the model's provider plus a non-empty prediction ID); the OpenRouter path returns inline base64 data URLs with no equivalent endpoint to clean up. There is no backfill: predictions created before this change remain in WaveSpeed history, and local image deletion (`deleteGeneratedImageById` / `deleteGeneratedImagesByIds`) does not contact the provider.

Failed generations are cleaned up too. Any error after the prediction is submitted — a moderation rejection, a poll timeout, an undecodable output, or a local write/DB failure — deletes the prediction before the error surfaces, because a failure still leaves the prompt (and sometimes a finished image) in the WaveSpeed account. Because that discards the only remote record of what went wrong, `classifyWaveSpeedFailureReason` first reduces the provider error to a coarse `content-rejected` or `provider-error` code and logs it as `wavespeed-generation-failed`. The raw provider error is inspected in memory only and never logged, since it can quote the prompt back. Content rejections also surface a distinct user-facing message ("The provider's content filter rejected this image. Try rephrasing the description.") so a censored prompt is distinguishable from an outage.

OpenRouter serves two kinds of image model, and they need different endpoints:

- Models that behave like chat models (Nano Banana Pro, Nano Banana 2, MAI-Image-2.5 Pro) post to `/api/v1/chat/completions` with the selected model's output modalities, an image-only system instruction, and `image_config` values for aspect ratio and image size. Text-plus-image models (the Nano Banana models) use `modalities: ["image", "text"]`; image-only models (`microsoft/mai-image-2.5-pro`) use `modalities: ["image"]`. OpenRouter returns generated images as base64 data URLs in `choices[0].message.images`.
- Native image-generation models (Krea 2 Medium) reject chat/completions outright — OpenRouter answers `404` with "is an image generation model and cannot be used with the chat/completions endpoint" — and post to `/api/v1/images` instead. That endpoint takes a flat `{model, prompt, aspect_ratio, resolution}` body with no system role, so the system instruction is folded into the single prompt string exactly as the WaveSpeed path does it. It returns naked base64 plus a separate `media_type` in `data[0]`, and no response identifier, so `providerResponseId` is null for these rows.

Which OpenRouter models need the images endpoint cannot be inferred from the model ID or its modalities, so they are listed explicitly in `OPENROUTER_IMAGES_ENDPOINT_MODELS` in `src/lib/generated-images.ts`. When adding an OpenRouter image model, check `https://openrouter.ai/api/v1/models/{id}/endpoints`: an `architecture.tokenizer` of `Media` with empty `supported_parameters` indicates a native image model that belongs in that set.

A non-ok response from either provider logs a sanitized `image-generation-request-failed` entry with the provider, model ID, and HTTP status — never the response body, which can quote the prompt back. A `401` or `403` surfaces as a distinct "provider rejected the API key" message, since that is fixed by correcting the key rather than by retrying.

The provider prompt combines the user's image description with the selected style direction. Built-in style presets are photographic, and custom style text is stored as the style direction for that generation.

Prompt shape is chosen per model in `src/lib/generated-images.ts`:

- Instruction-tuned models (GPT Image 2, the Nano Banana models) get the negation-based prompt: style, subject, then an `Avoid:` list.
- Diffusion models (Seedream 5 Pro, Qwen Image 3.0, MAI-Image-2.5 Pro, Krea 2 Medium) are listed in `AFFIRMATIVE_PROMPT_IMAGE_MODELS` and get an affirmation-only, photorealism-first prompt with no `Avoid:` list. They weight the earliest tokens most and read every token as content, so naming a style to exclude pulls that style into the image.
- Prompt-capped models are listed in `GENERATED_IMAGE_MODEL_PROMPT_LIMITS`. Qwen Image 3.0 accepts at most 800 characters, well under LocalInk's usual composed prompt, so those models get a compact variant: a short photorealism anchor, the subject, as much style direction as still fits, and `PHOTOREALISM_AFFIRMATIVE_PROMPT_COMPACT`. The subject keeps priority over the style preset, because it carries the user's actual intent; both are trimmed on a word boundary. Description enhancement for these models is also asked to fit the model's own budget rather than the usual 4,000-character ceiling.

The `/images/generate` workspace can enhance the image description before generation. Enhancement uses the app's main DeepSeek V4 text model through OpenRouter and returns an alternate image-description value. The workspace keeps the user's original input in the text field, shows the enhanced version below it, and lets the user choose which description to send for generation. The enhancement prompt includes the selected style direction, image model, aspect ratio, size, image-only system instruction, and final provider prompt template so the rewrite is optimized for the same prompt structure LocalInk will send to the image provider.

Image provider configuration comes from environment variables:

- `WAVESPEED_API_KEY`: required for GPT Image 2, Seedream 5 Pro, and Qwen Image 3.0 / 3.0 Pro generation.
- `OPENROUTER_API_KEY`: required for Nano Banana Pro, Nano Banana 2, MAI-Image-2.5 Pro, and Krea 2 Medium generation, and for image-description enhancement.
- `OPENROUTER_APP_NAME`: optional `X-Title` header value.
- `OPENROUTER_APP_URL`: optional `HTTP-Referer` header value.

## Local Storage

Generated image metadata is stored in the `generated_images` SQLite table. The binary image file is stored under the active data mode:

- `data/dev/generated-images/`
- `data/prod/generated-images/`

The database row stores only metadata and a relative file path. Server-side file resolution rejects absolute paths, parent-directory traversal, and paths outside the generated-images directory before reading or deleting files.

For WaveSpeed-generated rows, `provider_response_id` is kept as diagnostic metadata only. After the post-generation WaveSpeed cleanup described above, that ID typically refers to a prediction that no longer exists remotely.

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
