# Agent Setup

This project keeps Codex and Claude Code setup project-bound. `AGENTS.md` defines the shared operating contract; runtime-specific files adapt it to each agent.

## Instruction Loading

- `AGENTS.md` is the root project instruction file for Codex.
- `CLAUDE.md` includes `AGENTS.md` with `@AGENTS.md`, keeping Claude and Codex aligned at the project level.
- Repo-local skills are under `.agents/skills/`, which Codex scans from the current working directory up to the repo root.
- Claude Code discovers the same skill definitions through `.claude/skills/<name>` symlinks to `.agents/skills/<name>`.
- Codex custom agents are under `.codex/agents/`; matching Claude Code definitions are under `.claude/agents/`.

## Subagents

- `librarian`: keeps `docs/` accurate as durable project memory. Use after major changes and for repo-context questions that should be answered from docs first.
- Codex built-in `explorer`: use for read-only codebase discovery, diff reconnaissance, and audit slices that would otherwise consume the main context window. Use Claude Code's corresponding exploration capability there.
- Codex built-in `worker`: use for bounded implementation slices with clear, disjoint file ownership. Use Claude Code's general-purpose agents for corresponding implementation work.

The librarian's responsibilities and output contract match in both runtimes. Claude Code grants it `Agent` and `Skill` tools alongside file and shell tools so it can follow shared delegation and skill instructions. Codex uses medium reasoning effort; Claude Code uses Sonnet. These are runtime-specific choices, not identical model configurations.

`.codex/config.toml` sets:

```toml
[features]
hooks = true
multi_agent = true

[agents]
max_concurrent_threads_per_session = 12
max_depth = 3
job_max_runtime_seconds = 3600
```

Claude Code's `.claude/settings.json` sets `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=12` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=3` in `env`. These settings express the same intended concurrency and depth limits. Codex's `max_depth` applies to its V1 agent implementation; V2 ignores it, so the files do not enforce identical nesting behavior across runtimes. Keep delegation shallow in task instructions too.

## Startup Hooks

- `.codex/hooks.json` and `.claude/settings.json` register equivalent `SessionStart` commands for `startup|resume`.
- Each runtime calls its own `hooks/cleanup-tmp.sh`. Both delete regular files under `.tmp/` once at least seven days have elapsed and recreate `.tmp/plans/`.
- The scripts reject symlinks at `.tmp/` and `.tmp/plans/`, do not follow nested symlinks, and return a nonzero status on cleanup failures.
- Both hooks print a concise plan-memory reminder as startup context.

The definitions are project-bound; no user-level hook entry is required. Current Codex also requires trust for project hook definitions: review them in `/hooks`, including after definitions change. Enabling `features.hooks` alone does not approve project hooks.

## Operating Expectations

Plans must list the subagents and skills involved, including when a relevant one is intentionally skipped. The main agent should state its immediate non-delegated responsibility and keep final integration, user-facing tradeoffs, and verification in the parent thread.

When either runtime creates a plan, it must also write or update a plan file under `.tmp/plans/` using `YYYY-MM-DD-HHMMSS-<short-slug>.md`. Keep the file concise and update checklist statuses as work progresses.

Use subagents aggressively for non-trivial work when the runtime supports them. If subagents are unavailable, use focused file reads and `.tmp/` scratch notes to protect the main context window.

Use `.tmp/` only for transient scratchpad material. Durable project memory belongs under `docs/`.

The setup is self-improving: when a recurring agent/setup issue appears, suggest a project-bound improvement. If the improvement is clearly safe and within the user's requested scope, implement it with the change. Respect explicit read-only instructions.

## Skills

- `devdocs`: use for current external framework/API/SDK/CLI/browser/platform behavior. It records recurring sources in `docs/devdocs-index.md`.
- `review-diff`: use before committing or merging. It is read-only by default and leads with findings.
- `audit-codebase`: use for whole-repo readiness and quality audits. It reads docs as the intended contract.
- `audit-agents`: use when changing or reviewing agent setup. It checks project files against current vendor guidance.

## Current Vendor References

Checked on 2026-09-21. See `docs/devdocs-index.md` for recurring sources and older source-level references.

- Codex AGENTS.md discovery: https://developers.openai.com/codex/guides/agents-md
- Codex configuration reference: https://developers.openai.com/codex/config-reference
- Codex configuration schema (including V1-only depth limit): https://learn.chatgpt.com/docs/config-schema.json
- Codex skills: https://developers.openai.com/codex/skills
- Codex subagents: https://developers.openai.com/codex/subagents
- Codex hooks and project trust: https://learn.chatgpt.com/docs/hooks
- Claude Code memory and imports: https://code.claude.com/docs/en/memory
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code subagents, tools, and limits: https://code.claude.com/docs/en/sub-agents
- Agent Skills specification: https://agentskills.io/specification
