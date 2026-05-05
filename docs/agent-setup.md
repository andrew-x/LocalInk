# Agent Setup

This project keeps Codex setup project-bound. No user-level Codex files are required for the mechanisms below.

## Instruction Loading

- `AGENTS.md` is the root project instruction file for Codex.
- `CLAUDE.md` delegates to `AGENTS.md`, keeping Claude and Codex aligned at the project level.
- Repo-local skills are under `.agents/skills/`, which Codex scans from the current working directory up to the repo root.
- Codex custom agents are under `.codex/agents/`.

## Subagents

- `librarian`: keeps `docs/` accurate as durable project memory. Use after major changes and for repo-context questions that should be answered from docs first.
- Built-in `explorer`: use for read-only codebase discovery, diff reconnaissance, and audit slices that would otherwise consume the main context window.
- Built-in `worker`: use for bounded implementation slices with clear, disjoint file ownership.

`.codex/config.toml` sets:

```toml
[features]
codex_hooks = true

[agents]
max_threads = 6
max_depth = 1
```

This enables project-bound Codex hooks and favors broad first-level delegation while avoiding deep recursive subagent chains.

## Startup Hooks

- `.codex/hooks.json` registers a `SessionStart` command for `startup|resume`.
- `.codex/hooks/cleanup-tmp.sh` deletes regular files under `.tmp/` older than seven days and recreates `.tmp/plans/`.
- The hook prints a short plan-memory reminder. Codex treats successful `SessionStart` stdout as additional model context.

The hook is intentionally project-bound; no user-level `~/.codex/hooks.json` entry is required.

## Operating Expectations

Plans must list the subagents and skills involved, including when a relevant one is intentionally skipped. The main agent should state its immediate non-delegated responsibility and keep final integration, user-facing tradeoffs, and verification in the parent thread.

When Codex creates a plan, it must also write or update a plan file under `.tmp/plans/` using `YYYY-MM-DD-HHMMSS-<short-slug>.md`. Keep the file concise and update checklist statuses as work progresses.

Use subagents aggressively for non-trivial work when the runtime supports them. If subagents are unavailable, use focused file reads and `.tmp/` scratch notes to protect the main context window.

Use `.tmp/` only for transient scratchpad material. Durable project memory belongs under `docs/`.

The setup is self-improving: when a recurring agent/setup issue appears, suggest a project-bound improvement. If the improvement is clearly safe and within the user's requested scope, implement it with the change. Respect explicit read-only instructions.

## Skills

- `devdocs`: use for current external framework/API/SDK/CLI/browser/platform behavior. It records recurring sources in `docs/devdocs-index.md`.
- `review-diff`: use before committing or merging. It is read-only by default and leads with findings.
- `audit-codebase`: use for whole-repo readiness and quality audits. It reads docs as the intended contract.
- `audit-agents`: use when changing or reviewing agent setup. It checks project files against current vendor guidance.

## Current Vendor References

Checked on 2026-05-05:

- Codex AGENTS.md discovery: https://developers.openai.com/codex/guides/agents-md
- Codex skills: https://developers.openai.com/codex/skills
- Codex subagents: https://developers.openai.com/codex/subagents
- Codex hooks discovery source: https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/discovery.rs
- Codex `SessionStart` hook source: https://github.com/openai/codex/blob/main/codex-rs/hooks/src/events/session_start.rs
- Local Next docs entrypoint: `node_modules/next/dist/docs/index.md`
