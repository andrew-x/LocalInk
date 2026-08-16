# Devdocs Index

Recurring sources for implementation decisions that depend on current framework, API, SDK, CLI, browser, platform, or agent behavior.

| Source | URL or Path | Why It Matters | Last Checked |
| --- | --- | --- | --- |
| Codex AGENTS.md guide | https://developers.openai.com/codex/guides/agents-md | Project instruction discovery, precedence, and verification. | 2026-05-05 |
| Codex config basics | https://developers.openai.com/codex/config-basic#feature-flags | Config precedence, project `.codex/config.toml` loading, and feature flag placement. | 2026-05-08 |
| Codex hooks command runner source | https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/command_runner.rs | Hook command execution cwd, shell behavior, stdin, stdout, and timeout behavior. | 2026-05-05 |
| Codex hooks discovery source | https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs | Project `.codex/hooks.json` discovery and config-layer hook loading behavior. | 2026-05-05 |
| Codex llms.txt | https://developers.openai.com/codex/llms.txt | LLM-readable index for current Codex documentation. | 2026-05-05 |
| Codex SessionStart hook source | https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/session_start.rs | Startup/resume matcher behavior and stdout-as-context behavior for SessionStart hooks. | 2026-05-05 |
| Codex skills guide | https://developers.openai.com/codex/skills | Repo-local skill path, skill structure, and trigger guidance. | 2026-05-05 |
| Codex subagents guide | https://developers.openai.com/codex/subagents | `.codex/agents/*.toml` format and delegation config. | 2026-05-05 |
| Claude Code llms.txt | https://code.claude.com/llms.txt | LLM-readable index for Claude Code behavior when maintaining runtime parity. | 2026-05-05 |
| AI SDK llms.txt | https://ai-sdk.dev/llms.txt | LLM-readable index for AI SDK APIs and provider integration guidance. | 2026-05-05 |
| AI SDK generateText local types | `node_modules/ai/dist/index.d.ts` | Installed AI SDK 6 `generateText` options for one-shot text calls, including `prompt`, `system`, `providerOptions`, and token settings. | 2026-05-10 |
| AI SDK streamText local types | `node_modules/ai/dist/index.d.ts` | Installed AI SDK 6 `streamText` options, `abortSignal`, callbacks, `textStream` deltas, and `fullStream` finish/error parts. | 2026-05-07 |
| AI SDK OpenRouter provider | https://ai-sdk.dev/providers/community-providers/openrouter | Current OpenRouter provider package, `createOpenRouter`, chat model, and text generation examples. | 2026-05-05 |
| DeepSeek API model list | https://api-docs.deepseek.com/api/list-models | Current official DeepSeek V4 model IDs for direct API references and compatibility checks. | 2026-05-10 |
| DeepSeek models and pricing | https://api-docs.deepseek.com/quick_start/pricing | Current DeepSeek V4 Flash/Pro model details, context, output limits, and thinking-mode behavior. | 2026-05-10 |
| OpenRouter image generation guide | https://openrouter.ai/docs/guides/overview/multimodal/image-generation | Chat completions image generation payloads, output modalities, image config, and `message.images` response shape. | 2026-05-10 |
| OpenRouter image models collection | https://openrouter.ai/collections/image-models | Current OpenRouter image model names and IDs for Nano Banana Pro, Nano Banana 2, and Seedream 4.5. | 2026-05-10 |
| OpenRouter native image models API | https://openrouter.ai/api/v1/images/models | Authoritative list of `/api/v1/images` models with per-model `resolution` and `aspect_ratio` enums; native image models are absent from `/api/v1/models`. | 2026-08-14 |
| OpenRouter per-model image endpoints | https://openrouter.ai/api/v1/images/models/{model}/endpoints | Per-model `supported_parameters` enums and upstream provider for one images-endpoint model, e.g. `qwen/qwen-image-3-pro` (Alibaba Cloud Int.) and `x-ai/grok-imagine-image-2.0` (SpaceXAI). | 2026-08-16 |
| OpenRouter ZDR endpoints list | https://openrouter.ai/api/v1/endpoints/zdr | Authoritative list of which model endpoints support Zero Data Retention; the check when deciding if a text or image model needs the ZDR-exempt or single-endpoint-fallback treatment described in `docs/ai-prose-generation.md` and `docs/ai-image-generation.md`. | 2026-08-16 |
| OpenRouter provider routing guide | https://openrouter.ai/docs/guides/routing/provider-selection | Per-request `provider` field semantics, including `zdr`, `only`/`order`/`ignore`, and how request-level and account-level settings combine. | 2026-08-16 |
| OpenRouter Zero Data Retention guide | https://openrouter.ai/docs/guides/features/zdr | ZDR enforcement scope: per-request `provider.zdr` is OR'd with account and guardrail settings, so it can only tighten routing, never loosen it. | 2026-08-16 |
| WaveSpeed Qwen Image 3.0 Pro text-to-image (dormant path) | https://wavespeed.ai/docs/docs-api/alibaba/alibaba-qwen-image-3.0-pro-text-to-image | Qwen Image 3.0 Pro endpoint, request parameters, prompt-length cap, prediction response shape, and result polling URL. No model routes to WaveSpeed today. | 2026-08-16 |
| WaveSpeed Grok 2 Image (dormant path) | https://wavespeed.ai/docs/docs-api/x-ai/x-ai-grok-2-image | Grok 2 Image endpoint and its narrow request schema — `prompt`, `num_images`, `enable_sync_mode`, `enable_base64_output`, with no aspect ratio, resolution, seed, or output format. | 2026-08-14 |
| WaveSpeed base64 output (dormant path) | https://wavespeed.ai/docs/base64-output | Base64 output behavior for sync and polled predictions, including naked base64 strings without data URI prefixes. | 2026-05-10 |
| WaveSpeed delete task (dormant path) | https://wavespeed.ai/docs/delete-task | Predictions delete endpoint request/response shape used for post-generation WaveSpeed history cleanup. | 2026-08-11 |
| Bun llms.txt | https://bun.com/llms.txt | LLM-readable index for Bun runtime, package manager, and lockfile behavior. | 2026-05-05 |
| Drizzle ORM llms.txt | https://orm.drizzle.team/llms.txt | LLM-readable index for Drizzle ORM schema, query, and migration guidance. | 2026-05-05 |
| React Hook Form standard schema resolver | `node_modules/@hookform/resolvers/standard-schema/dist/standard-schema.d.ts` | Local type source for `standardSchemaResolver`, used by `src/lib/schemas/resolve.ts` as the project form resolver. | 2026-05-05 |
| Lexical docs intro | https://lexical.dev/docs/intro | Entry point for Lexical editor concepts, nodes, plugins, and React integration for the manuscript editor. | 2026-05-04 |
| Lexical React getting started | https://lexical.dev/docs/getting-started/react | React setup path for Lexical composer, plugins, editor configuration, and initial editor state patterns for the manuscript editor. | 2026-05-05 |
| Lucide llms.txt | https://lucide.dev/llms.txt | LLM-readable index for Lucide icon usage and package guidance. | 2026-05-05 |
| Next local docs | `node_modules/next/dist/docs/index.md` | Installed Next 16 docs for framework-sensitive implementation. | 2026-05-05 |
| Next use server directive | `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` | Dedicated `"use server"` files for Server Functions imported by Client Components and server-side return-value constraints. | 2026-05-06 |
| Next data security guide | `node_modules/next/dist/docs/01-app/02-guides/data-security.md` | Data access layer pattern for keeping Server Functions thin and delegating database work to `server-only` modules. | 2026-05-06 |
| Next Route Handlers | `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` | App Router route-handler convention, supported HTTP methods, caching defaults, and native `Response` handling. | 2026-05-06 |
| Next Server Actions guide | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` | "Sequential dispatch on the client" — Server Actions run one at a time per client, and the documented remedy for parallel mutation is a Route Handler. Basis for the `/api/generated-images/generate` carve-out in `docs/backend-actions.md`. | 2026-08-14 |
| Next serverExternalPackages | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` | Opting Node-specific server packages out of bundling so they use native Node `require`. | 2026-05-06 |
| Next App dynamic routes | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` | App Router dynamic segment convention and async `params` typing for story routes. | 2026-05-05 |
| Next Link component | `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` | Client-side navigation to dynamic story routes from story lists. | 2026-05-05 |
| Next redirect function | `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` | Redirect behavior and constraints when choosing between server redirects and client navigation after mutations. | 2026-05-05 |
| Next llms.txt | https://nextjs.org/llms.txt | LLM-readable index for current Next docs and API guidance. | 2026-05-05 |
| Next font module | https://nextjs.org/docs/app/api-reference/components/font | Current `next/font` API for Google font variables and Tailwind integration. | 2026-05-05 |
| next-safe-action action client | https://next-safe-action.dev/docs/concepts/action-client | Current safe action client creation, metadata, error handling, and client hierarchy guidance. | 2026-05-05 |
| next-safe-action hooks | https://next-safe-action.dev/docs/guides/hooks | Current `useAction` API for imperative client-side mutations. | 2026-05-05 |
| next-safe-action middleware | https://next-safe-action.dev/docs/guides/middleware | Current middleware API for logging, timing, and action gates. | 2026-05-05 |
| next-safe-action React Hook Form adapter | https://next-safe-action.dev/docs/integrations/react-hook-form | Current `useHookFormAction` adapter package, imports, and callback pattern. | 2026-05-05 |
| React Hook Form get started | https://react-hook-form.com/get-started | Current `useForm`, registration, validation, submission, and TypeScript guidance for form implementation. | 2026-05-05 |
| Sass documentation | https://sass-lang.com/documentation/ | Sass language and tooling reference if Sass enters the styling stack. | 2026-05-05 |
| shadcn/ui components.json | https://ui.shadcn.com/docs/components-json | Current CLI configuration for New York style, Tailwind v4 CSS path, aliases, and CSS variables mode. | 2026-05-05 |
| shadcn/ui llms.txt | https://ui.shadcn.com/llms.txt | LLM-readable index for shadcn/ui component and CLI guidance. | 2026-05-05 |
| shadcn/ui Sonner | https://ui.shadcn.com/docs/components/sonner | Current toast guidance, including Sonner installation, app-level `Toaster`, and `toast` usage. | 2026-05-05 |
| shadcn/ui Tailwind v4 | https://ui.shadcn.com/docs/tailwind-v4 | Current shadcn guidance for Tailwind v4, `@theme inline`, OKLCH colors, `data-slot`, and `tw-animate-css`. | 2026-05-05 |
| sqlite-vec JavaScript usage | https://alexgarcia.xyz/sqlite-vec/js.html | Current `sqlite-vec` npm package loading behavior for better-sqlite3 and JavaScript vector binding. | 2026-05-06 |
| sqlite-vec KNN and regular tables | https://alexgarcia.xyz/sqlite-vec/features/knn.html | Current guidance for using regular SQLite BLOB columns with sqlite-vec validation and distance functions. | 2026-05-06 |
| Tailwind CSS dark mode | https://tailwindcss.com/docs/dark-mode | Current class-driven dark variant setup using `@custom-variant`. | 2026-05-05 |
| Tailwind CSS theme variables | https://tailwindcss.com/docs/theme | Current `@theme`, `@theme inline`, and utility namespace behavior. | 2026-05-05 |
| Tailwind CSS utility classes | https://tailwindcss.com/docs/styling-with-utility-classes | Tailwind docs entry point for utility-first styling and navigation to related docs. | 2026-05-05 |

Add sources here only when they are likely to be reused. Prefer official docs, local package docs, release notes, migration guides, and API references.
