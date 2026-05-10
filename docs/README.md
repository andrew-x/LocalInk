# LocalInk Project Memory

Read this file first for repo-context questions. Keep it concise and link to focused docs instead of duplicating details.

## Product Contract

LocalInk is a local-first fiction writing app with AI assistance. The app runs manually on the user's machine and is not intended for cloud deployment. Next is used as the local application framework; backend code may use server-side filesystem reads and writes when that is the right product choice.

Protect user writing and project files as private local data. Prefer durable local formats, clear migration paths, and inspectable state.

## Current Repo Shape

- Framework: Next 16 app in `src/app`.
- Styling/tooling: Tailwind 4, Biome, TypeScript.
- Package manager: Bun. Use `bun run <script>` for project scripts.
- Agent setup: root `AGENTS.md`, repo-local skills in `.agents/skills/`, Codex subagents in `.codex/agents/`.
- Scratch space: `.tmp/` is transient and ignored by git.

## Docs Index

- `docs/agent-setup.md`: project-bound Codex instructions, skills, and subagents.
- `docs/backend-actions.md`: action logging, `next-safe-action` mutation clients, read/write structure, and schema split.
- `docs/database.md`: local SQLite data paths, Drizzle schema/migrations, and startup migration behavior.
- `docs/devdocs-index.md`: recurring documentation sources for framework/API/agent work.
- `docs/ai-prose-generation.md`: prose generation goals, prompt architecture, context hierarchy, provider behavior, and drafting rationale.
- `docs/ai-image-generation.md`: image generation via WaveSpeed and OpenRouter, local generated-image storage, routes, and privacy/logging rules.
- `docs/styling.md`: Tailwind v4, SCSS token hub, fonts, shadcn/ui, and common component conventions.

## Maintenance Rules

- Use the `librarian` subagent after major implementations, architecture changes, data model/auth/security/deployment changes, new user-facing behavior, or major doc reorganizations.
- Update this index when adding durable docs.
- Do not store transient planning notes here; use `.tmp/` for scratch notes.
