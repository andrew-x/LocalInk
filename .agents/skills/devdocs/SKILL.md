---
name: devdocs
description: Use when implementation depends on current framework, API, SDK, CLI, browser, runtime, or platform behavior. Prefer official docs, local package docs, release notes, migration guides, and API references. Return concise guidance with source links, and when edits are permitted add useful recurring sources to docs/devdocs-index.md.
---

# Devdocs

Use this skill before making implementation choices that depend on current external behavior.

## Workflow

1. Identify the exact technology and version from repo files first: `package.json`, lockfiles, config, installed package docs, or CLI output.
2. Prefer local docs bundled with installed packages. For Next in this repo, start with `node_modules/next/dist/docs/index.md`, then read the focused page it points to.
3. If local docs are missing or insufficient, use official docs, release notes, migration guides, and API references. Avoid blogs and forum posts unless official sources do not cover the issue.
4. Return concise guidance: decision, constraints, relevant version, and source links or local file paths.
5. If edits are permitted and a source will be useful again, update `docs/devdocs-index.md` with the title, URL/path, why it matters, and the last-checked date. In read-only tasks, recommend the index update instead.

## Guardrails

- Do not rely on model memory for fast-moving APIs.
- Do not make code changes as part of docs lookup unless the user or parent task explicitly asks for implementation.
- Do not edit any files when the user or parent task asked for read-only research.
- If sources conflict with repo behavior, report the conflict and recommend the smallest verification step.
