# External References

Sources supporting non-obvious explanations in these docs. Dates record past checks, not current availability or a requirement to refresh every source on routine changes. Consult current documentation when changing the behavior involved; add a source only when it supports a retained explanation.

| Source | URL or Path | Why It Matters | Last Checked |
| --- | --- | --- | --- |
| Codex configuration schema | https://learn.chatgpt.com/docs/config-schema.json | Exact field semantics, including `agents.max_depth` applying to V1 threads and being ignored by V2. | 2026-09-21 |
| Codex hooks | https://learn.chatgpt.com/docs/hooks | Project hook discovery, `/hooks` review, and trust tied to the exact hook definition; changed definitions require review again. | 2026-09-21 |
| Claude Code subagents | https://code.claude.com/docs/en/sub-agents | Agent definitions, `Agent` and `Skill` tool access, concurrent-subagent and spawn-depth environment limits. | 2026-09-21 |
| Venice privacy architecture | https://docs.venice.ai/overview/privacy | Private means zero retention; Anonymized obscures identity without promising upstream retention protection. Kimi and selected image models are deliberate Anonymized exceptions. | 2026-10-28 |
| Venice model catalogs | https://api.venice.ai/api/v1/models?type=text and https://api.venice.ai/api/v1/models?type=image | Exact IDs, privacy, context/completion ceilings, tools/schema support, image prompt caps and sizing constraints. Recheck before replacing a model. | 2026-10-28 |
| Venice native image generation | https://docs.venice.ai/api-reference/endpoint/image/generate | Single-image base64 flow, model-specific sizing, prompt metadata/enhancement controls, and moderation flags. | 2026-10-28 |
| Venice reasoning controls | https://docs.venice.ai/guides/features/reasoning-models | Model-specific effort support and shared reasoning/completion budget; hiding reasoning does not remove its token cost. | 2026-10-28 |
| Next Server Actions guide | `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` | "Sequential dispatch on the client" — Server Actions run one at a time per client, and the documented remedy for parallel mutation is a Route Handler. Basis for the `/api/generated-images/generate` carve-out in `docs/backend-actions.md`; rechecked in installed Next 16.2.11 for the Backstory action workflow. | 2026-09-25 |
| Installed AI SDK 6 tool lifecycle | `node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx` | Installed `inputSchema`, `execute`, and `stepCountIs` contracts take precedence over newer indexed examples. Manuscript approval stays an application action over the stored candidate, rather than resuming model generation through native tool approval. | 2026-10-09 |
| AI SDK structured output | https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data | Schema-validated `Output.object` supports the suggestion shortlist; normal completion remains a separate acceptance requirement. | 2026-10-13 |
| Installed Lexical update tags | `node_modules/lexical/dist/LexicalUpdateTags.d.ts` | Explicit history push and custom update tags support importing a committed manuscript change without an accidental autosave or history merge; selection suppression avoids focus theft. | 2026-10-09 |
| shadcn/ui Tailwind v4 | https://ui.shadcn.com/docs/tailwind-v4 | Current shadcn guidance for Tailwind v4, `@theme inline`, OKLCH colors, `data-slot`, and `tw-animate-css`. | 2026-05-05 |
