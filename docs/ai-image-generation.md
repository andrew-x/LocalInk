# AI Image Generation

Generated assets are stored locally, but generation sends prompts to the selected provider. Privacy depends on verified routing and sanitized logs, not on local storage alone.

## Provider Flow

All selectable models use Venice's native [`/image/generate`](https://docs.venice.ai/api-reference/endpoint/image/generate) endpoint, authenticated server-side with `VENICE_API_KEY`. One request produces one base64 image; LocalInk validates the actual bytes and dimensions before local persistence rather than assuming the requested PNG format was honored.

Venice's [image catalog](https://api.venice.ai/api/v1/models?type=image) was checked on 2026-10-28 for every selected ID. All seven were classified **Anonymized**, a deliberate user-approved privacy exception. Venice's proxy does not store normal inference prompt/response content, but Anonymized hides account identity from the upstream provider without promising that provider cannot see or retain content. Do not describe these image choices as Private or end-to-end zero retention; see [Venice privacy](https://docs.venice.ai/overview/privacy). Requests never fall back to another model or provider.

Per-model capability maps are required: unsupported aspect ratios are mapped deterministically to the nearest supported ratio, resolution is clamped to a supported tier, and models without a resolution parameter omit it. Pixel dimensions must not be sent to the Qwen family. Catalog availability alone does not demonstrate successful generation or output quality; recheck exact IDs, privacy classifications, supported ratios/resolutions, and prompt caps when replacing a model.

Prompt limits apply to the entire composed provider prompt, including instructions and style, not just the writer's description. LocalInk's explicit enhancement workflow uses Flash; Venice's additional enhancement is disabled to avoid a second rewriter changing the composed request. Embedded prompt metadata is disabled. Moderation flags and empty or malformed output are operation failures, not locally saved images.

Historical OpenRouter and WaveSpeed images keep their original provider/model metadata even though those generation adapters have been removed. Reading or deleting a local historical image does not require the old provider or initiate remote cleanup; a stored response ID may refer to a remote record already deleted by the former adapter.

### Prompt Decisions

Affirmation-only prompts are conservative choices for some models, not proof of their architecture or negation handling. Prompt-capped models prioritize the subject over style expansion, preserving user intent within the upstream limit.

Skin realism is described through texture and tone rather than repeated lesion words. Repetition across style, system guidance, and prompt layers amplified acne/redness; condition nouns belong only in negative prompts for models that can use them. Similarly, words such as “unretouched” and “documentary” were generalized to dirty settings. Prompts distinguish an unstyled photograph from an unclean place, and enhancement must not invent decay.

## Local Storage

Image files and SQLite metadata share the selected `data/<mode>/` isolation boundary. Paths are stored relatively; server resolution rejects absolute paths, traversal, and escapes from the generated-images directory.

`prompt` means the description actually sent. `original_prompt` is present only when enhancement replaced the writer's wording; null means `prompt` is the original wording. Older rows cannot recover originals that were never saved. User-facing descriptions prefer the original, and prefilling restores the enhancement separately rather than silently replacing editable user text.

Retired or unknown model IDs normalize to the current default only when prefilling a generation form. Stored rows retain the actual generating model; compatibility normalization must not rewrite history.

## Concurrent Generation

Generation uses a mutation Route Handler because client Server Actions serialize calls. Preserve the [action-boundary safeguards](backend-actions.md#route-handler-carve-out). The gallery is already dynamic, so this route does not need the former action's path revalidation.

The concurrency cap leaves browser connection headroom for navigation, thumbnails, and prompt enhancement; it is not a provider rate limit. Jobs are session-local rather than durable queue records. A completion does not take the stage from an explicitly selected image; per-job failures stay associated with that job rather than becoming form-global failures.

Navigating away abandons the browser request but does not cancel server generation: completed images still reach local storage and the gallery. This is a deliberate scope decision, not an implied cancellation guarantee.

## Logging And Privacy

Prompts, output text, images, provider bodies, and local paths are private. Log sanitized operational metadata only. Provider moderation errors can quote the submitted prompt, so replace them with coarse rejection codes rather than logging the message.

### Failure Logging

Generation failures have one structured `image-generation-failed` record. Provider errors are reduced to bounded scalar metadata and short sanitized messages; raw objects must not pass through those fields. Refusal output is never logged because it can restate the prompt. Non-JSON gateway errors still need sanitization before useful infrastructure details are retained.
