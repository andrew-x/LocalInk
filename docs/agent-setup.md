# Agent Setup

`AGENTS.md` is the shared operating contract; `CLAUDE.md` includes it rather than maintaining a second copy. Shared skills live in `.agents/skills/`, with Claude discovery provided by `.claude/skills/` symlinks. Change the shared source, preserving those links.

## Runtime Parity

Codex and Claude librarian definitions must express the same responsibilities, while retaining their native configuration formats and model choices. Routine changes do not require documentation or librarian delegation; use it for substantive explanations and focused repo-context research.

Concurrency and depth settings express the same intended limits in both runtimes, but enforcement differs: Codex's `max_depth` applies to V1 agents; V2 ignores it. Keep delegation shallow in task instructions too. Claude's librarian needs `Agent` and `Skill` access to follow shared delegation and skill instructions.

Both startup hooks maintain transient `.tmp/plans/` memory and remove regular scratch files after seven elapsed days. They reject symlinked scratch roots and do not follow nested symlinks. This is recoverable session context, not durable documentation.

## Hook Trust

Project hooks require Codex trust: review them in `/hooks`, including after definitions change. Enabling the hooks feature alone does not approve project hooks. No user-level hook registration is needed.

These runtime caveats were checked on 2026-09-21. See [external references](devdocs-index.md) before changing runtime behavior.
