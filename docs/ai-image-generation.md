# AI Image Generation

LocalInk can generate reference images through server-side image providers while keeping generated assets in the local data folder.

## Provider Flow

Every model in `GENERATED_IMAGE_MODELS` goes through OpenRouter. The WaveSpeed provider path is still in the codebase, but no model routes to it — see [WaveSpeed (Dormant)](#wavespeed-dormant).

OpenRouter serves two kinds of image model, and they need different endpoints:

- Models that behave like chat models (Nano Banana Pro, Nano Banana 2, Nano Banana 2 Lite) post to `/api/v1/chat/completions` with the selected model's output modalities, an image-only system instruction, and `image_config` values for aspect ratio and image size. Text-plus-image models (the Nano Banana models) use `modalities: ["image", "text"]`; image-only models use `modalities: ["image"]`. OpenRouter returns generated images as base64 data URLs in `choices[0].message.images`.
- Native image-generation models (GPT Image 2, Seedream 5 Pro, Krea 2 Large, Riverflow V2.5 Pro, FLUX.2 Max, Qwen Image 3 Pro, Grok Imagine Image 2.0) reject chat/completions outright — OpenRouter answers `404` with "is an image generation model and cannot be used with the chat/completions endpoint" — and post to `/api/v1/images` instead. That endpoint takes a flat `{model, prompt, aspect_ratio, ...}` body with no system role, so the system instruction is folded into the single prompt string the same way the WaveSpeed path does it. It returns naked base64 plus a separate `media_type` in `data[0]`, and no response identifier, so `providerResponseId` is null for these rows.

Which OpenRouter models need the images endpoint cannot be inferred from the model ID or its modalities, so they are listed explicitly in `OPENROUTER_IMAGES_ENDPOINT_MODELS` in `src/lib/generated-images.ts`. The check when adding a model is `https://openrouter.ai/api/v1/models`: a model absent from it is native-only and belongs in that set. Presence in `https://openrouter.ai/api/v1/images/models` decides nothing on its own — the chat-style Nano Banana models are listed there too and work on both endpoints.

The images endpoint validates every field against per-model enums, while LocalInk offers one app-wide list of sizes and aspect ratios. `OPENROUTER_IMAGES_MODEL_CAPABILITIES` in `src/lib/server/generated-images.ts` mirrors the `supported_parameters` enums that `/api/v1/images/models` publishes, and `buildOpenRouterImagesRequestBody` clamps or drops fields rather than letting the request fail. Those enums describe what the model can render rather than what one endpoint accepts, so `buildOpenRouterChatRequestBody` clamps `image_config` against the same entries:

- GPT Image 2 (`openai/gpt-image-2`): declares **no `resolution` parameter at all** — it sizes its own output from the aspect ratio — so the field is omitted and LocalInk's image-size choice has no effect for this model. It is the one images-endpoint model that takes `quality`, which is sent as `"medium"`. Every aspect ratio except `4:5` and `5:4`.
- Seedream 5 Pro (`bytedance-seed/seedream-5-0-pro`): `1K`/`2K`, and every aspect ratio the app offers.
- Krea 2 Large (`krea/krea-2-large`): `1K` only, and only `1:1`, `4:3`, `3:2`, `16:9`, `4:5`, `2:3`, `9:16`.
- Riverflow V2.5 Pro (`sourceful/riverflow-v2.5-pro`): `1K`/`2K`/`4K`, no `quality`, and every aspect ratio the app offers except `4:5` and `5:4`. It is listed only for that ratio enum, since its size range already covers the app's.
- FLUX.2 Max (`black-forest-labs/flux.2-max`): declares **no `resolution` parameter at all** — it sizes its own output from the aspect ratio — so the field is omitted and LocalInk's image-size choice has no effect for this model, the same as GPT Image 2. No `quality` either. Every aspect ratio except `4:5` and `5:4`.
- Qwen Image 3 Pro (`qwen/qwen-image-3-pro`): `1K`/`2K`, no `quality`, and every aspect ratio the app offers except `21:9`. It also publishes extreme ratios (`1:4`, `4:1`) that LocalInk does not offer.
- Grok Imagine Image 2.0 (`x-ai/grok-imagine-image-2.0`): `1K`/`2K`, and only `1:1`, `3:4`, `4:3`, `2:3`, `3:2`, `9:16`, `16:9` of the app's ratios — its other published ratios are ultra-tall and ultra-wide shapes LocalInk does not offer. Its `quality` enum is `low`/`medium`, so it takes the app-wide `"medium"`.
- Nano Banana 2 Lite (`google/gemini-3.1-flash-lite-image`): the one chat-style model with an entry. It is the cost-efficient Gemini image tier and renders at `1K` only, unlike its Pro and non-Lite siblings, so `2K` and `4K` clamp down instead of reaching Google as a size it cannot produce. Its ratio enum covers every ratio the app offers.

Sizes clamp down to the largest supported one; aspect ratios fall back to the nearest supported proportion (compared in log space), so `5:4` becomes `4:3` on GPT Image 2, Krea, Riverflow, FLUX.2 Max, and Grok Imagine. Models absent from the map are sent through unclamped, which is most chat-style models — they already cover every size and ratio the app offers.

A non-ok response from either provider logs an `image-generation-failed` entry with reason `provider-http-error`, carrying the provider, model ID, HTTP status, and the sanitized error code and message pulled out of the body (see [Failure Logging](#failure-logging)). A `401` or `403` surfaces as a distinct "provider rejected the API key" message, since that is fixed by correcting the key rather than by retrying.

### Zero Data Retention Routing

Every OpenRouter image request pins Zero Data Retention provider routing by default, the same as the text path (see `docs/ai-prose-generation.md#provider-notes`). `buildOpenRouterChatRequestBody` and `buildOpenRouterImagesRequestBody` in `src/lib/server/generated-images.ts` both call a private `buildOpenRouterImageProviderRouting(model)` helper and emit a top-level `provider: { zdr: true }` field when it applies.

`generatedImageModelRequiresZdrProvider` in `src/lib/generated-images.ts` decides which models get the field, via an explicit exemption set (`ZDR_EXEMPT_IMAGE_MODELS`) rather than an inference rule — a newly added model defaults to requiring ZDR unless it is added to the set. As of 2026-08-16, five models have zero ZDR-listed endpoints and are exempt: `openai/gpt-image-2`, `qwen/qwen-image-3-pro`, `x-ai/grok-imagine-image-2.0`, `sourceful/riverflow-v2.5-pro`, and `black-forest-labs/flux.2-max`. Riverflow (provider `sourceful`) and FLUX.2 Max (provider `black-forest-labs/us-3`) are each served by a single provider that publishes no ZDR endpoint, so requesting ZDR would 404 rather than route them anywhere safer. The other five models (Nano Banana Pro, Nano Banana 2, Nano Banana 2 Lite, Seedream 5 Pro, Krea 2 Large) each have exactly one ZDR-listed endpoint, so ZDR routing leaves them no fallback to a non-ZDR provider — an outage at that single upstream now surfaces as a generation failure rather than being routed around. Check `https://openrouter.ai/api/v1/endpoints/zdr` before adding a model to decide which side of the exemption it belongs on.

**`/api/v1/images` ignores `provider.zdr`.** Verified 2026-08-16 against the live API: a request for `qwen/qwen-image-3-pro` (which has no ZDR-listed endpoint) with `provider: { zdr: true }` returned an image instead of refusing, where the same constraint on `/api/v1/chat/completions` correctly refuses with "No endpoints found matching your data policy (Zero data retention)". The flag alone is therefore decorative on the images endpoint.

That endpoint does honor `provider.only`, so the two non-exempt images-endpoint models pin their ZDR-listed provider by slug instead of trusting the flag. `ZDR_PROVIDER_SLUGS_BY_IMAGE_MODEL` in `src/lib/generated-images.ts` maps `bytedance-seed/seedream-5-0-pro` to `seed` and `krea/krea-2-large` to `krea`, and `buildOpenRouterImageProviderRouting` adds `only` plus `allow_fallbacks: false` alongside `zdr` for them. Both models are currently served by exactly one provider, which is also their ZDR-listed one, so pinning costs no routing breadth today — it keeps the request correct if OpenRouter later adds a non-ZDR provider. Slugs are the `tag` field from `https://openrouter.ai/api/v1/endpoints/zdr`; verify one against the `available_providers` list in a 404 body before adding it.

The chat-style models (the three Nano Banana models) need no slug pin, because `/api/v1/chat/completions` enforces `zdr` correctly.

A 404 whose body matches one of OpenRouter's privacy-routing refusals (`looksLikeOpenRouterZdrUnavailableBody` in `src/lib/ai.ts`, which shares its markers with the AI SDK detector used by the text paths) is treated as ZDR unavailability. Two wordings are matched: the `zdr` refusal ("No endpoints found matching your data policy") and the `provider.only` refusal ("No allowed providers are available"), since LocalInk only ever sends `only` to pin a ZDR provider. Such a 404 is handled as its own case rather than as a generic provider error: `toProviderResponseError` logs it as `openrouter-no-zdr-provider` (see [Failure Logging](#failure-logging)) and returns `ActionError("AI_ZDR_UNAVAILABLE", ...)` telling the user to choose a different model. `enhanceGeneratedImagePrompt` maps the same condition to `AI_ZDR_UNAVAILABLE`. The `/api/generated-images/generate` route maps `AI_ZDR_UNAVAILABLE` to a `503` response.

This routing does not apply to the WaveSpeed path: WaveSpeed has no provider-routing concept, and the path is dormant regardless (see [WaveSpeed (Dormant)](#wavespeed-dormant)).

The provider prompt combines the user's image description with the selected style direction. Built-in style presets are photographic, and custom style text is stored as the style direction for that generation.

Prompt shape is chosen per model in `src/lib/generated-images.ts`:

- Instruction-tuned models (GPT Image 2, the Nano Banana models) get the negation-based prompt: style, subject, then an `Avoid:` list.
- Diffusion models (Seedream 5 Pro, Qwen Image 3 Pro, Krea 2 Large, Riverflow V2.5 Pro, FLUX.2 Max) are listed in `AFFIRMATIVE_PROMPT_IMAGE_MODELS` and get an affirmation-only, photorealism-first prompt with no `Avoid:` list. They weight the earliest tokens most and read every token as content, so naming a style to exclude pulls that style into the image. Grok Imagine Image 2.0 is listed there too, for a different reason: its prompt cap is smaller than the negation-based system instruction alone, so prepending that block would spend the whole budget before reaching the subject.
- Prompt-capped models are listed in `GENERATED_IMAGE_MODEL_PROMPT_LIMITS`. Qwen Image accepts at most 800 characters and Grok about 1,000 (xAI's own cap is 1,024), well under LocalInk's usual composed prompt, so those models get a compact variant: a short photorealism anchor, the subject, as much style direction as still fits, and `PHOTOREALISM_AFFIRMATIVE_PROMPT_COMPACT`. The subject keeps priority over the style preset, because it carries the user's actual intent; both are trimmed on a word boundary. Description enhancement for these models is also asked to fit the model's own budget rather than the usual 4,000-character ceiling. OpenRouter publishes no prompt-length limit of its own, but it proxies these requests to the same upstreams (Alibaba Cloud, xAI), so the caps still apply.

Skin realism across all three prompt shapes is calibrated by texture rather than by lesions. The style preset, `PHOTOREALISM_INSTRUCTIONS`, and `PHOTOREALISM_AFFIRMATIVE_PROMPT` all reach the model in the same request, and image models read every noun as content, so repeating "blemishes" or "redness" across those layers reads as emphasis and comes back as acne. Skin is described with texture and tone words (pores, fine hairs, faint freckles, light asymmetry); condition nouns live only in `PHOTOREALISM_NEGATIVE_PROMPT`, where negation-capable models can act on them and affirmative-prompt models never see them.

Settings carry the same guard. Words that describe the photography — "unretouched", "uncurated", "candid", "documentary", "everyday clutter" — get generalized by the model to the depicted world, and come back as stained carpets and peeling paint. The prompts therefore state outright that the place is clean and well-kept and only the photograph is unstyled, and the description-enhancement system prompt is told not to invent wear or decay the user did not ask for.

The `/images/generate` workspace can enhance the image description before generation. Enhancement uses the app's main DeepSeek V4 text model through OpenRouter and returns an alternate image-description value. The workspace keeps the user's original input in the text field, shows the enhanced version below it, and lets the user choose which description to send for generation. The enhancement prompt includes the selected style direction, image model, aspect ratio, size, image-only system instruction, and final provider prompt template so the rewrite is optimized for the same prompt structure LocalInk will send to the image provider.

Generating with the enhanced version selected persists both: the server resolves which text reaches the provider and which (if either) was the user's own wording (see [Local Storage](#local-storage)). Returning to a past image via `/images/generate?source=<id>` prefills the text field with the user's own description rather than the AI-expanded prose. If that image was generated from an enhanced version, the enhanced text is also restored into the "Enhanced prompt" preview with the toggle already on, so an unchanged prefill reproduces the same source image; editing the description flips the toggle back to the typed text so an edit is never silently discarded.

Models are retired from `GENERATED_IMAGE_MODELS` as providers deprecate them or move between providers, but stored rows keep whichever ID was current when they were written. `normalizeGeneratedImageModel` therefore resolves any deprecated or unrecognized ID to `DEFAULT_GENERATED_IMAGE_MODEL` rather than to a curated per-model replacement — including the WaveSpeed-era `alibaba/qwen-image-3.0-pro/text-to-image` and `x-ai/grok-2-image` IDs, which are close relatives of the current OpenRouter entries but not the same models. This affects only what a prefilled generate form selects; the row's `model` column is left alone, so the gallery and lightbox still show which model actually produced the image.

Image provider configuration comes from environment variables:

- `OPENROUTER_API_KEY`: required for every image model LocalInk offers, and for image-description enhancement.
- `OPENROUTER_APP_NAME`: optional `X-Title` header value.
- `OPENROUTER_APP_URL`: optional `HTTP-Referer` header value.
- `WAVESPEED_API_KEY`: unused while the WaveSpeed path is dormant. Only needed if a model is pointed back at that provider.

### Adding Or Updating A Model

Per-model behavior is listed explicitly rather than inferred, so a new or upgraded model ID needs each of these checked. Model IDs are version-pinned, so a version bump is a new model for every purpose below.

1. **Registry** — add the entry to `GENERATED_IMAGE_MODELS` in `src/lib/generated-images.ts`. The Zod enum in `src/actions/generated-images/_schemas.ts` and the picker in `generate-image-form.tsx` both derive from it.
2. **Endpoint** — check `https://openrouter.ai/api/v1/models`. A model absent from it is native-only and belongs in `OPENROUTER_IMAGES_ENDPOINT_MODELS` (see [Provider Flow](#provider-flow)).
3. **ZDR** — check `https://openrouter.ai/api/v1/endpoints/zdr` for that exact ID. No entries means it must go in `ZDR_EXEMPT_IMAGE_MODELS` or it will 404 at generation time; entries plus the images endpoint means it needs a slug in `ZDR_PROVIDER_SLUGS_BY_IMAGE_MODEL`, because that endpoint ignores `provider.zdr` (see [Zero Data Retention Routing](#zero-data-retention-routing)).
4. **Capabilities** — check `https://openrouter.ai/api/v1/images/models/{model}/endpoints` for the `resolution` and `aspect_ratio` enums and whether `quality` is supported, then add `OPENROUTER_IMAGES_MODEL_CAPABILITIES` in `src/lib/server/generated-images.ts`. The endpoint rejects values it does not declare.
5. **Prompt shape** — diffusion and prompt-capped models belong in `AFFIRMATIVE_PROMPT_IMAGE_MODELS` and `GENERATED_IMAGE_MODEL_PROMPT_LIMITS`.

The enumerating test in `src/lib/server/generated-images.test.ts` walks `GENERATED_IMAGE_MODELS` and asserts the set of unrouted models exactly matches the recorded exemption policy, so it catches a model being exempted in code without that decision being written down, or losing ZDR routing unintentionally. It cannot tell you whether a *new* model actually has ZDR endpoints — only step 3's live check does that. A model missed there fails loudly as a 404 at generation time rather than silently reaching a retaining provider.

### WaveSpeed (Dormant)

No model routes to WaveSpeed today: Qwen Image and Grok both moved to OpenRouter (`qwen/qwen-image-3-pro`, `x-ai/grok-imagine-image-2.0`). The provider path below is kept intact and typechecked — `"wavespeed"` stays in `GENERATED_IMAGE_PROVIDERS` in `src/lib/generated-images.ts` for that reason, since inferring the provider union from the model list alone would make these branches unreachable — so a model can be pointed back at it by setting `provider: "wavespeed"` on its entry. Rows generated while those models were on WaveSpeed keep `provider: "wavespeed"` and their old model IDs.

A WaveSpeed model posts to `/api/v3/{providerModelId}` (e.g. `/api/v3/alibaba/qwen-image-3.0-pro/text-to-image`) from server-only code. The request body is built per model from a `WAVESPEED_MODEL_CAPABILITIES` map in `src/lib/server/generated-images.ts` (keyed by `providerModelId`), since WaveSpeed models vary in max resolution and supported fields. Every WaveSpeed model schema sets `additionalProperties: false`, so a field a model does not declare is rejected outright rather than ignored. Each field is therefore gated on a capability flag, and only the composed `prompt` goes to every model:

- Qwen Image 3.0 Pro (`alibaba/qwen-image-3.0-pro/text-to-image`): tops out at `2k` and accepts only `prompt`, `aspect_ratio`, `resolution`, `enable_prompt_expansion`, and `seed`. It sends `enable_prompt_expansion: false` — LocalInk composes its own photorealism prompt and has a separate enhancement step, so the provider's prompt rewriter would fight it — and cannot send `output_format`, `enable_sync_mode`, or `enable_base64_output`.
- Grok 2 Image (`x-ai/grok-2-image`): accepts only `prompt`, `num_images`, `enable_sync_mode`, and `enable_base64_output`. It declares **no `aspect_ratio` and no `resolution`**, sizing every output itself at up to 1024x1024, so both fields are dropped rather than clamped and LocalInk's aspect-ratio and image-size controls have no effect for it. Rows still record what the user selected. It always returns JPEG.
- Models with no entry in the map fall back to `WAVESPEED_DEFAULT_MODEL_CAPABILITIES`: aspect ratio and resolution, `2k` max, base64 output, sync mode, and output format, with no `quality` or `enable_prompt_expansion`.

WaveSpeed returns a prediction ID first. LocalInk polls the provider result URL until the prediction is `completed`, then reads the output. Models that accept `enable_base64_output` return naked base64. Only models that also declare `output_format` are told to render PNG, so `detectWaveSpeedBase64MimeType` reads the container from the payload's own leading bytes instead of assuming one — Grok 2 Image answered with JPEG, and a hardcoded PNG label would store the wrong extension and `mime_type`. An unrecognized header falls back to PNG, and the full payload is validated downstream regardless. Models that cannot return base64 (Qwen Image 3.0 Pro) hand back a CDN URL, so `downloadWaveSpeedGeneratedImage` fetches it over HTTPS with a timeout and a size cap, and derives the MIME type from the image's own magic bytes rather than a provider-supplied header. Either way the bytes are written into the local generated-images directory. The download happens before the prediction cleanup below, and a failed download deletes the prediction too, since nothing was stored locally.

Once a WaveSpeed image is written to disk and its metadata row is committed to SQLite, LocalInk calls `deleteWaveSpeedPrediction(predictionId)` (in `src/lib/server/generated-images.ts`) to `POST /api/v3/predictions/delete` and remove the prediction from the user's WaveSpeed account history. This is a local-first privacy measure: once the bytes and metadata are durable locally, the provider-side copy (which retains the prompt and output) is redundant. The delete only fires after both the file write and DB insert succeed, so a local-persistence failure can never lose the image. It is best-effort, time-boxed, and never throws — a non-ok response, network failure, or timeout only logs a sanitized `wavespeed-prediction-delete-failed` error and never turns a successful generation into an error. This cleanup is WaveSpeed-only (gated on the model's provider plus a non-empty prediction ID); the OpenRouter path returns inline base64 data URLs with no equivalent endpoint to clean up. There is no backfill: predictions created before the cleanup existed remain in WaveSpeed history, and local image deletion (`deleteGeneratedImageById` / `deleteGeneratedImagesByIds`) does not contact the provider.

Failed generations are cleaned up too. Any error after the prediction is submitted — a moderation rejection, a poll timeout, an undecodable output, or a local write/DB failure — deletes the prediction before the error surfaces, because a failure still leaves the prompt (and sometimes a finished image) in the WaveSpeed account. Because that discards the only remote record of what went wrong, `classifyWaveSpeedFailureReason` first reduces the provider error to a coarse `content-rejected` or `provider-error` code and logs it as `image-generation-failed` with reason `wavespeed-prediction-failed`. The provider's own error text is logged only when it is not a moderation message, since that is the failure whose text quotes the prompt back (see [Failure Logging](#failure-logging)). Content rejections also surface a distinct user-facing message ("The provider's content filter rejected this image. Try rephrasing the description.") so a censored prompt is distinguishable from an outage.

## Local Storage

Generated image metadata is stored in the `generated_images` SQLite table. The binary image file is stored under the active data mode:

- `data/dev/generated-images/`
- `data/prod/generated-images/`

The database row stores only metadata and a relative file path. Server-side file resolution rejects absolute paths, parent-directory traversal, and paths outside the generated-images directory before reading or deleting files.

`prompt` is always the description actually sent to the provider. A nullable `original_prompt` column holds the user's own typed description, set only when description enhancement replaced it with different text before generation; a blank, absent, or unchanged enhancement leaves it `null`. `null` therefore means "`prompt` is the user's own wording" — which is also all a row written before this column existed (migration `0004_generated-image-original-prompt.sql`) can say, since those originals are unrecoverable. The lightbox and gallery show `original_prompt` (falling back to `prompt`) as the user-facing description, plus a separate "Enhanced prompt" field when `original_prompt` is set.

For rows generated while a model was on WaveSpeed, `provider_response_id` is kept as diagnostic metadata only. After the post-generation WaveSpeed cleanup described above, that ID typically refers to a prediction that no longer exists remotely.

## User-Facing Workflow

Generated image actions live under `src/actions/generated-images/`. Reads use logged Server Functions and mutations use `publicActionClient` metadata, following `docs/backend-actions.md`.

Current routes:

- `/images/generate`: image generation workspace.
- `/images`: generated image gallery.
- `/api/generated-images/[imageId]/content`: local image content response by generated image ID.
- `/api/generated-images/generate`: `POST` Route Handler that runs image generation. See [Concurrent Generation](#concurrent-generation) for why this is a route rather than a Server Action.

Viewing a generated image up close is an in-place overlay lightbox, not a page navigation. `GeneratedImageLightbox` (`src/components/generated-images/generated-image-lightbox.tsx`) is a shared component built on Radix Dialog (focus trap, scroll lock) that reuses the zoom/pan hook in `use-generated-image-lightbox-viewport.ts` (1x-5x zoom, wheel zoom, drag to pan, double-click toggle) and provides chrome for download, a generation-details drawer, and "Use settings". It is used from three places:

- the generate workspace (`generate-image-workspace.tsx`): walks the current session's completed generations (`onIndexChange` keeps the workspace's staged job and the lightbox index in sync), not just the one staged image.
- the gallery grid (`generated-image-gallery.tsx`): opens on thumbnail click, with previous/next buttons and ArrowLeft/ArrowRight keys to walk the gallery.
- the slideshow: the same component with an `autoPlay` prop (6s interval, Space to pause), replacing the old inline slideshow implementation.

In the generate workspace, the staged image stays fully opaque and interactive while other generations run; progress lives in the job rail rather than as a dimmed overlay on the stage. See [Concurrent Generation](#concurrent-generation).

## Concurrent Generation

The `/images/generate` workspace can run up to `MAX_CONCURRENT_IMAGE_GENERATIONS` (3, in `src/lib/generated-image-generation-contract.ts`) generations at once instead of one at a time.

**Transport.** Generation is a `POST` Route Handler (`src/app/api/generated-images/generate/route.ts`), not a Server Action. Next dispatches Server Actions one at a time per client, so concurrent `executeAsync` calls would queue rather than run in parallel — see `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` ("Sequential dispatch on the client") and `docs/backend-actions.md` for the carve-out conditions this route satisfies. Do not move this back to a Server Action; that would reintroduce single-flight behavior. `revalidatePath("/images")` was dropped, not moved elsewhere: `src/app/images/page.tsx` calls `connection()`, so the gallery is already fully dynamic per request.

**Concurrency cap.** Three is a browser connection-pool constraint, not a provider rate limit: browsers cap concurrent connections per origin at roughly six, and each in-flight generation holds one open for as long as the provider takes to answer (minutes, for a large image). Three leaves headroom for thumbnail requests, navigation, and the prompt-enhancement Server Action. At the cap, the Generate button uses `aria-disabled` rather than `disabled`, so it does not drop keyboard focus.

**Session-only job tray.** `use-generated-image-jobs.ts` tracks generations as client-only `GeneratedImageJob` state (`pending` / `complete` / `failed`) — nothing is persisted, there is no jobs table or migration, and the tray does not survive a reload. The server-prefilled image becomes "job zero" so the rail, stage, and lightbox all read one uniform list. The tray holds at most 12 entries, dropping the oldest settled-and-seen jobs first.

**Rail auto-hide.** `generated-image-job-rail.tsx` renders a vertical thumbnail rail on the stage's right edge, but only when there are 2+ jobs; with 0 or 1 it renders nothing, so single-generation use looks exactly as before. Visible tiles show a pending spinner with `m:ss` elapsed, a completed thumbnail, or a failed alert icon, plus an unseen dot; the rail is a `role="listbox"` with ArrowUp/ArrowDown/Home/End/Escape navigation and focus recovery when a tile is removed.

**Stage focus rule.** A job completing does not steal the stage from whatever is currently staged — it only gets an unseen badge in the rail. The one exception is the very first completion in a session where nothing has been explicitly staged yet, which takes the stage rather than leaving it blank.

**Failures are per-job.** A failed generation shows a Sonner error toast, a failed rail tile, and a stage failure panel with "Try again" when that job is staged. `form.setError("root")` is reserved for prompt-enhancement failures, validation, and the at-cap message — not per-generation failures.

**No cancellation.** Navigating away or closing the tab abandons the `fetch`, but the server-side generation still runs to completion and the image still lands in the gallery and local storage. This is a deliberate scope decision, not a gap to fix reflexively.

## Logging And Privacy

Generated image prompts and image bytes are private user data. Do not log prompt text, provider prompt bodies, base64 image data, binary image contents, local filesystem paths, raw action payloads, or provider response bodies that may contain image data.

Logs may include sanitized operational metadata such as action names, generated image IDs, counts, durations, success state, and sanitized error codes.

### Failure Logging

Every generation failure emits exactly one `image-generation-failed` entry from `src/lib/server/generated-images.ts`, so `grep image-generation-failed` answers "why did that image fail" without the log ever carrying the prompt, a response body, image bytes, or a stack trace. `logGeneratedImageFailure` drops keys with no value, so an entry only shows what was known where it was thrown.

Fields:

| Field | Meaning |
| --- | --- |
| `reason` | Which throw site fired, from the `GeneratedImageFailureReason` union — for example `provider-http-error`, `wavespeed-poll-timeout`, `wavespeed-download-unrecognized-format`, `openrouter-missing-image`, `openrouter-no-zdr-provider`, `base64-too-large`, `local-persistence-failed`. |
| `model` / `provider` | The selected image model and its provider. |
| `status` | HTTP status, or the WaveSpeed prediction status for an incomplete prediction. |
| `providerErrorCode` | Short enum-like code from the provider: an error code or type, a `finish_reason`, a MIME type, or `content-rejected` / `provider-error`. |
| `providerErrorMessage` | The provider's own message, or a short factual note such as a byte count or output count. |
| `providerName` | Upstream provider OpenRouter routed to, from `error.metadata.provider_name`. |
| `errorName` / `errorCode` | Thrown error name (`AbortError`, `TypeError`) and Node errno label (`ENOSPC`, `EEXIST`) for network and filesystem failures. |

Provider text is sanitized before it is logged, by `summarizeProviderErrorBody` and `sanitizeProviderErrorText`:

- Only `code`, `type`, `metadata.provider_name`, and `message` are read out of an error body. The body itself is never logged, because it can carry image data.
- `code`/`type` are kept only when they are scalars of 64 characters or less, so a nested object cannot smuggle payload data through a normally enum-like field.
- Messages are whitespace-collapsed and truncated to 200 characters.
- A message matching `CONTENT_REJECTION_MARKERS` is replaced with `[content-rejection text withheld]`. Moderation messages are the ones that quote the rejected prompt back; infrastructure errors ("upstream timeout", "insufficient credits") do not, and are the detail worth reading.
- Bodies that are not JSON (an HTML gateway page) fall back to the sanitized text itself, which is where providers put the useful part when they answer in plain text.

Model output text is never logged. When a chat-style model answers with a refusal instead of an image, the entry records the `finish_reason` and how many images came back, not the refusal, which restates the prompt.
