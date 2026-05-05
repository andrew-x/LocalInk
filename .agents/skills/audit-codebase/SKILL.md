---
name: audit-codebase
description: Use for whole-repo production-readiness or quality audits. Inventories apps, packages, config, docs, and critical paths; reads docs as the intended contract; runs safe health checks; and reports code quality, bugs, edge cases, security/privacy, performance, ops, tests, and docs drift. Read-only by default.
---

# Audit Codebase

Use this skill for broad repo audits and readiness reviews.

## Workflow

1. Read `docs/README.md` first when it exists, then focused docs that define intended behavior.
2. Inventory the repo: apps, packages, configs, scripts, data/storage paths, AI/provider integrations, and local filesystem boundaries.
3. Run safe health checks such as `bun run lint` when dependencies are present. Ask before installing dependencies or running commands that are expensive, destructive, or likely to rewrite generated output.
4. Spot-read critical paths rather than dumping the whole repo into context. Prioritize user data, filesystem writes, AI orchestration, persistence, editor workflows, and app routing.
5. Compare implementation to docs and product direction. Note docs drift and missing docs.
6. Stay read-only unless the user explicitly asks for fixes.

## Output

Report:

- Executive summary.
- Findings by severity with file/line references where possible.
- Code quality and maintainability risks.
- Bugs and edge cases.
- Security/privacy and local-data risks.
- Performance and operational concerns for local manual running.
- Test and verification gaps.
- Docs drift.
- Recommended next actions.
