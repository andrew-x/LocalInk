# Backend Actions

Mutations use `publicActionClient`; read Server Functions use `runLoggedAction`. Their shared metadata and sanitized errors keep operational logs consistent without exposing user writing. LocalInk has no auth layer: these boundaries do not imply user identity checks.

## Privacy And Form Boundaries

Shared action infrastructure owns start/end/error logging; entrypoints should not add duplicate lifecycle logs. Log operational metadata and sanitized error codes, never writing, prompts, raw payloads, local paths, or user-visible stack traces. Keep substantial filesystem/data access in server-only helpers.

Form schemas describe editable values; action schemas validate the complete payload, including injected IDs. Client validation never substitutes for server validation. Use the React Hook Form/next-safe-action adapter so server failures reach form state, with sanitized Sonner errors for operation failures.

## Route Handler Carve-Out

Next dispatches Server Actions sequentially per client. Concurrent `executeAsync` calls therefore cannot provide parallel image generation. A durable mutation may use a Route Handler when that dispatch behavior is the blocker, provided it reproduces the action boundary:

1. Validate with the same Zod schema the action would use.
2. Wrap execution in `runLoggedAction` with the same metadata shape.
3. Honor `IS_MAINTENANCE_MODE` by throwing `ActionError("MAINTENANCE", ...)` inside the logged call.
4. Preserve `ActionError` codes and public messages in the HTTP response.

The image generation route uses this exception; see [concurrent generation](ai-image-generation.md#concurrent-generation). Prose/chat streaming routes are non-mutating reads and have a separate reason to use Route Handlers.

Chat's edit tools only prepare candidates. Its streaming route stages completed output in temporary server memory; an action then atomically finalizes the assistant reply and proposal. Separate resolution actions apply or undo stored proposals. Keeping these durable writes behind the action boundary also prevents streamed or browser-modified candidate text from becoming an implicit manuscript mutation; see [proposal safety](ai-prose-generation.md#manuscript-proposal-safety).

A Route Handler form has no action to bridge, so it uses React Hook Form with `formResolver` directly. Zod defaults can make schema input/output types differ; account for both in the form's generics rather than assuming one type.

The sequential-dispatch constraint was checked against installed Next 16.2.11 documentation on 2026-09-25; see [external references](devdocs-index.md).
