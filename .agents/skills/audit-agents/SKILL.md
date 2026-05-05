---
name: audit-agents
description: Use when changing or reviewing AGENTS.md, runtime docs, skills, subagents, or Codex/agent setup. Inventories all agent and skill definitions, checks against current vendor guidance, verifies parity between runtimes, and reports findings, drift, opportunities, recommendations, and consulted sources.
---

# Audit Agents

Use this skill for reviewing Localink's agent setup.

## Workflow

1. Inventory project-scoped agent files:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `.codex/config.toml`
   - `.codex/hooks.json` and `.codex/hooks/*`
   - `.codex/agents/*.toml`
   - `.claude/settings.json` and `.claude/settings.local.json`
   - `.claude/hooks/*`
   - `.claude/agents/*.md`
   - `.claude/skills/*/SKILL.md`
   - `.agents/skills/*/SKILL.md`
   - Skill `agents/openai.yaml` files if present
   - Other runtime instruction files if added later
2. Use `devdocs` when current Codex, Claude Code, skill, or subagent behavior matters. Prefer official OpenAI Codex docs, Anthropic Claude Code docs, and the Agent Skills spec.
3. Check discovery paths, trigger descriptions, scope boundaries, read/write permissions, context efficiency, and runtime parity. Today, `CLAUDE.md` delegates to `AGENTS.md` and the Codex/Claude Code setups (hooks, librarian subagent, skills) mirror each other; preserve that parity unless there is a strong reason not to.
4. Check whether skills overlap, trigger too broadly, or duplicate durable docs.
5. Stay read-only unless the user explicitly asks you to update the setup.

## Output

Report:

- Files read.
- Findings by severity.
- Drift from current vendor guidance.
- Runtime parity notes.
- Opportunities to improve context efficiency or delegation.
- Recommended changes.
- Consulted sources with links or local paths.
