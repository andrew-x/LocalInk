---
name: review-diff
description: Use before committing or merging. Reviews unstaged, staged, and optionally branch-level diffs. Read-only by default. Checks correctness, edge cases, security/privacy, downstream effects, conventions, verification, and essential explanations. Reports blockers, should-fix items, nits, open questions, and verification.
---

# Review Diff

Use this skill for a pre-commit, pre-merge, or branch review.

## Workflow

1. Determine scope:
   - Run `git status --short`.
   - Inspect unstaged diff with `git diff`.
   - Inspect staged diff with `git diff --staged`.
   - If branch-level review is requested, compare against the live target branch when available; in Superconductor, use `get_worktree_status.target_branch`.
2. Read changed files in context, including nearby call sites and existing explanations affected by behavior changes. Where tests exist, read them as needed to understand the change.
3. Reconstruct the intended change before judging it. If intent is unclear, state the assumption.
4. Review for correctness, edge cases, data loss, security/privacy, local-first filesystem effects, downstream contracts, conventions, and appropriate verification. Flag stale explanations and missing essential non-obvious rationale. Tests are opt-in: do not treat absent tests, missing coverage, or undocumented straightforward code as routine findings.
5. Stay read-only unless the user explicitly asks you to fix findings.

## Output

Lead with findings, ordered by severity:

- Blockers: must fix before commit/merge.
- Should-fix: high-value issues that should be addressed soon.
- Nits: small cleanup only when it improves maintainability.
- Open questions: decisions needing user or product input.
- Verification: checks run, checks skipped, and residual risk.

Use file and line references when possible. If there are no findings, say that directly. Report actual verification limits or unresolved correctness concerns without creating blanket test or documentation requirements.
