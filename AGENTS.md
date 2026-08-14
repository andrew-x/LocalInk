# LocalInk Agent Instructions

## Product Direction

LocalInk is a local-first fiction writing app with AI assistance, in the spirit of Novelcrafter or NovelAI, but designed to run manually on the user's machine. Although it is built as a Next app, it is not intended for deployment.

- Optimize for local use, local privacy, and filesystem-backed workflows.
- Do not design around Vercel/serverless/cloud deployment constraints unless the user explicitly asks.
- Backend code may read and write local files when that is the right product choice. Keep filesystem access server-side and treat user writing/project files as private data.
- Prefer durable, inspectable local data formats and migration paths over opaque remote services.

## Collaboration Style

- Act as a thought partner, not just an order taker. If a request seems suboptimal, risky, or based on a mistaken assumption, state the concern and suggest a better path.
- Make conservative implementation choices that fit the existing codebase and the local-first product direction.
- When you notice a recurring issue or a way to improve this agent setup, suggest it to the user. If the improvement is clearly safe and project-bound, implement it as part of the relevant change.
- Use `.tmp/` for transient scratch notes when useful for context efficiency. Do not rely on `.tmp/` for committed project memory.

## Planning and Delegation

For any task that needs a plan, create or update a plan file under `.tmp/plans/` before starting implementation. Use the filename format `YYYY-MM-DD-HHMMSS-<short-slug>.md`. Keep the plan current as statuses change so recent planning context can be recovered from `.tmp` when needed.

When creating plans, include:

- Subagents that will be used or intentionally skipped.
- Skills that will be used or intentionally skipped.
- The main agent's immediate non-delegated responsibility.
- A concise checklist with current statuses.

Use subagents aggressively for non-trivial tasks when the runtime supports them, especially for read-only discovery, docs maintenance, review, and parallel audits. Keep the main agent focused on integration, user-facing decisions, and final verification. If subagents are unavailable, keep context tight with focused file reads and `.tmp/` scratch notes.

`.tmp/plans/` is transient plan memory, not durable docs. Session startup hooks clean stale `.tmp` files older than seven days.

## Project Subagents

- `librarian`: Docs maintainer. Use after large implementations, architecture changes, data model/auth/security/deployment changes, new user-facing behavior, or major doc reorganizations. Also use for repo-context questions when durable docs may answer them.
- Built-in `explorer` agents: Use for read-only codebase discovery, branch/diff reconnaissance, and focused audits that would otherwise fill the main context window.
- Built-in `worker` agents: Use for bounded implementation slices with disjoint file ownership. Tell workers they are not alone in the codebase and must not revert others' changes.

## Project Skills

Repo-local skills live in `.agents/skills/`.

- `devdocs`: External documentation lookup for current framework, API, SDK, CLI, browser, or platform behavior.
- `review-diff`: Pre-commit/pre-merge diff review.
- `audit-codebase`: Whole-repo production-readiness audit.
- `audit-agents`: Agent setup audit for AGENTS.md, runtime docs, skills, subagents, and related config.

Use these by name when the task matches. Before framework-sensitive implementation, use `devdocs`; this project uses Next 16, so read focused local docs under `node_modules/next/dist/docs/` before relying on training memory.

## Runtime Parity

Keep the Codex (`.codex/`) and Claude Code (`.claude/`) project setups in sync. Both runtimes should expose the same instructions, hooks, subagents, and skills so behavior does not depend on which runtime the user launched.

- Shared instructions: `AGENTS.md` is the source of truth. `CLAUDE.md` `@`-includes it.
- Hooks: `.codex/hooks.json` + `.codex/hooks/*` and `.claude/settings.json` + `.claude/hooks/*` should run equivalent SessionStart cleanup and emit equivalent additional context.
- Subagents: every entry in `.codex/agents/*.toml` should have a matching `.claude/agents/*.md` with the same name, description, and instructions, ported to each runtime's format.
- Skills: skill definitions live in `.agents/skills/<name>/SKILL.md` as the single source of truth. `.claude/skills/<name>` symlinks point at them. Add new skills there and create the matching symlink.

When changing any of these in one runtime, mirror the change in the other in the same task. Use the `audit-agents` skill to check parity when the setup changes.

## Documentation Memory

- `docs/README.md` is the durable project memory index. Read it first for repo-context questions.
- Update docs through the `librarian` subagent after major behavior, architecture, or data model changes.
- Keep docs concise and current. Prefer links to focused docs over large duplicated explanations.

## Quality Bar

- In TypeScript/React code, use the project Day.js wrapper from `src/lib/dayjs.ts` for date creation, parsing, comparison, and formatting. Do not import `dayjs` directly from the package or use native `Date`/`Intl.DateTimeFormat` for app-level date handling unless a platform API requires it. Database-side SQL defaults/triggers may use SQLite timestamp functions because they run inside SQLite.
- LocalInk has no auth layer. Actions must not accept, infer, or check user identity unless the product direction changes.
- Mutations must use `publicActionClient` with `.metadata(...)`; read Server Functions must use `runLoggedAction` with the same metadata shape. Keep action entrypoints thin, avoid ad hoc start/end logs, and put filesystem or data-access work in backend-only helpers under `src/lib/server/` when it grows beyond a small operation. A mutation may use a Route Handler instead only when Server Action sequential dispatch is itself the blocker (e.g. concurrent generations); see `docs/backend-actions.md` for the required conditions.
- App logs must never include user writing, prompts, manuscript text, raw action payloads, local filesystem paths, or stack traces exposed to users. Log operational metadata such as action names, IDs when needed, counts, durations, success state, and sanitized error codes.
- In `src/actions/[feature]/`, reserve unprefixed files for action and read entrypoints. Put action-local Zod schemas in `_schemas.ts` and shared action types in `_types.ts`; keep the full action pattern documented in `docs/backend-actions.md`.
- Forms that call actions should use React Hook Form, Zod, and `useHookFormAction` from `@next-safe-action/adapter-react-hook-form/hooks`; do not manually wire `useForm` plus `useAction` for forms. Push server-level failures into React Hook Form and also show a sanitized Sonner error toast. A form whose submit target is a carve-out Route Handler rather than an action still uses React Hook Form and Zod, but wires `useForm` with `formResolver` directly, since there is no action to bridge to.
- User-visible client workflows should show an error toast whenever an operation encounters an error. Keep field validation and actionable form messages inline too, but use Sonner error toasts for operation-level failures such as failed saves, failed deletes, failed loads, and unexpected action errors. Toast sanitized user-facing messages only; do not expose stack traces, raw prompts, manuscript text, or local filesystem paths.
- Database schema changes must update the Drizzle TypeScript schema and generated SQL migrations together. Use `bun run db:generate -- --name=<migration-name>` for generated migrations, and do not hand-edit local SQLite data files or ignored `data/` contents as part of normal app changes.
- Keep styling token-driven: map new colors through semantic tokens in `src/styles/globals.scss`, and use `font-content` for long-form manuscript text.
- Use Bun for package and script commands. For this repo, start verification with `bun run lint`; run broader checks when behavior or integration risk justifies it.
- Do not run the app to test changes unless the user explicitly asks. This includes starting the dev server, launching the local app in a browser, or using browser automation against it. After completion, describe what the user should manually verify instead.
- Use `review-diff` before committing or merging.
- Protect user work: never revert unrelated changes unless the user explicitly asks.
