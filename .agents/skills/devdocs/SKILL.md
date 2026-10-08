---
name: devdocs
description: Use when implementation depends on current framework, API, SDK, CLI, browser, runtime, or platform behavior. Prefer official docs, local package docs, release notes, migration guides, and API references. Return concise guidance with source links; durable source notes are only needed to support non-obvious project explanations.
---

# Devdocs

Use this skill before making implementation choices that depend on current external behavior.

## Workflow

1. Identify the exact technology and version from repo files first: `package.json`, lockfiles, config, installed package docs, or CLI output.
2. Prefer local docs bundled with installed packages. For Next in this repo, start with `node_modules/next/dist/docs/index.md`, then read the focused page it points to.
3. If local docs are missing or insufficient, use official docs, release notes, migration guides, and API references. Avoid blogs and forum posts unless official sources do not cover the issue.
4. Return concise guidance: decision, constraints, relevant version, and source links or local file paths.
5. Record a source in `docs/devdocs-index.md` only when edits are permitted and it supports a retained non-obvious explanation or decision. Include why it matters and the actual last-checked date. Routine lookups do not require durable documentation or an index-update recommendation.

## Guardrails

- Do not rely on model memory for fast-moving APIs.
- Do not make code changes as part of docs lookup unless the user or parent task explicitly asks for implementation.
- Do not edit any files when the user or parent task asked for read-only research.
- If sources conflict with repo behavior, report the conflict and recommend the smallest verification step.
