# AI Prose Generation

Generation produces writer-controlled draft candidates, with continuity and insertion fidelity taking priority over generic assistant output. Local-first privacy belongs in data handling and logging, not model-facing prose instructions that distract from the writing task.

## Prompt Contract

Stable behavior and instruction interpretation live in the system prompt; dynamic request values and manuscript context live in escaped XML-style fields. Escaping prevents user text from accidentally creating or closing structural tags. Omit blank optional fields rather than adding prose placeholders that could be mistaken for material to continue.

The current task is intentionally repeated near the beginning and end of long requests to keep it salient. Distinct short insertion anchors locate the edit without duplicating large overlapping manuscript windows. This bookending is intentional; duplicating the same value under competing tags is not.

Writer-authored story instructions are the exception to request-data placement: although supplied with each request, they are policy and enter the system prompt after global writer instructions, taking precedence as the more specific guidance. Varying that prompt per story is acceptable because the current ZDR routing already loses the main model's implicit caching.

## Context Hierarchy

The manuscript at the cursor establishes canon and character knowledge. Later text constrains what the passage leads into, not what characters already know. Explicit current requests can revise facts and mechanics within the selected span; insertion boundaries still protect surrounding text.

Voice follows current instructions, story/global writer preferences, curated samples, and style guidance ahead of manuscript register and app defaults. Much of the manuscript is model-generated, so asking the model to imitate its own earlier prose compounded stylistic drift. Voice samples are deliberately curated, non-canon register references; automatically selecting recent output would preserve that drift.

Backstory is historical reference, not system policy or a required flashback. Preserve uncertainty and who knows what; past relationships do not freeze present ones or mandate future outcomes.

Focused-chapter context includes unsaved edits and uses Markdown like the stored chapters. Plain-text serialization previously dropped italics from precisely the chapter being continued. Ordinary regeneration re-derives local insertion anchors; selection rewrites keep their captured original context.

### Chapter Synopses

Synopses are background-derived caches, never an extra model call inside prose generation. Freshness uses a versioned hash of trimmed chapter content rather than timestamps. The version invalidates legacy summaries of truncated or incomplete sources without bulk regeneration or a schema migration.

Only eligible whole chapters with normally completed, nonempty summaries are cached. Refresh happens after saved changes settle or a chapter becomes active, and skips unsaved edits. Conditional writes compare both the source and prior cache snapshot, preventing late responses from overwriting newer content or summaries.

The server loads and verifies synopsis provenance against the request's actual manuscript snapshots; browser-supplied summary text is ignored. Missing, stale, or ineligible caches are omitted. A focused-chapter synopsis is usable as established story state only for a genuine end append without a selection; mid-chapter edits need the actual surrounding prose.

### Context Degradation

There is no retrieval/indexing pipeline. Reduction is positional: preserve focused insertion context, then favor nearby chapters; reduce distant chapters to verified summaries or explicitly partial excerpts. Keep chapter order and represent omissions so the model is not invited to invent missing facts.

Budget the complete escaped system and request prompts, including repeated anchors and writer instructions, plus framing, output, and applicable reasoning allowances. UTF-8 bytes provide a conservative token estimate. If protected context and instructions still cannot fit, fail with `MANUSCRIPT_CONTEXT_TOO_LARGE` rather than silently losing the edit boundary. Unbounded generation omits a word target but still has a provider output cap. Reasoning headroom is an allowance, not a guarantee limiting hidden reasoning.

## Chat Context

Chat supports planning, drafting reusable story references, and proposing manuscript edits. Each turn captures an immutable manuscript snapshot, including unsaved editor Markdown and the active selection. Unaccepted prose previews contribute their original manuscript, not preview text. Story title, description, instructions, style, voice samples, characters, backstory, and locations come from saved references; there is no separate outline field. Saved instructions are editable references here, not authority over chat output format. Voice examples contribute register, not facts or wording to recycle.

The initial prompt includes the active chapter, chapter catalog, and provenance-verified summaries. Bounded read/search tools access other chapters from that same snapshot, so later typing cannot silently change a tool's source. Context accounting includes history, tool inputs/results, and output/reasoning allowances. Reduction removes whole lower-priority context units and identifies omissions; edit targets must be read as exact text rather than inferred from summaries. Oversized protected context fails instead of silently truncating the requested edit. Full-book snapshots are temporary; durable proposals retain only affected chapter baselines and results.

Field-drafting commands use accepted discussion decisions and saved references, with current corrections taking priority. Rejected branches and unconfirmed suggestions must not become canon. Historical commands are not re-expanded; shared guidance remains active for ordinary clarification answers and revisions. Only a voice demonstration permits a minimally invented non-canon situation. Results are manually reviewed and saved by the writer, never applied automatically.

### Manuscript Proposal Safety

An edit tool constructs a proposal against exact, unambiguous spans in the captured manuscript; it cannot write chapters. Application approval deliberately happens outside the model's tool loop: approving an immutable stored result must not resume generation and produce different text. Metadata remains read-only. Proposal statuses enter later conversation context, while each new turn reads the manuscript afresh; pending, denied, and undone edits are not canon. Earlier proposal text can be retrieved for follow-up discussion as historical reference, never as a substitute for reading current edit targets.

Completed replies and proposals are staged in bounded, expiring server memory before a separate action persists them together. A completed stream alone is not durable: expiry or a server restart before finalization requires regeneration. Finalization retries return an already-persisted generation and cannot substitute browser-supplied edit content. Pending proposals survive reload only after finalization. Proposal-bearing replies cannot be regenerated in place because doing so would erase decision and Undo history; ask for a revised proposal in a new message.

Approval and Undo first pause affected editors, drain pending saves, and flush unsaved writing. Active prose drafts block resolution. Chapter saves use revision-based compare-and-swap, and resolution checks exact chapter bodies as well as revisions inside one transaction. A changed or deleted chapter rejects the entire operation rather than partially applying edits or overwriting newer writing. Undo restores the original chapters only while every affected chapter still matches the accepted result; it does not merge subsequent writing.

An autosave failure pauses its queue and preserves local writing. Retry repeats the uncertain write with its original revision before sending newer text; an identical already-saved body succeeds safely, but a true conflict never silently adopts another tab's revision. Copy unsaved writing before reloading to reconcile a conflict.

Committed results are imported with an explicit history boundary and autosave suppression before editors resume. Markdown must round-trip through the editor without losing formatting. If importing a committed result fails, editors stay paused for saved-content recovery. Lost resolution responses are reconciled against durable proposal status before saves resume; repeating a decision must never apply or reverse it twice.

## Drafting Decisions

The default contract favors prose that covers the requested beat and remains continuable. Generic workshop rules were reduced because they amplified the model's default literary register; repeated anti-closure rules made it circle a beat rather than advance. The removed craft guidance remains an opt-in preset, giving it writer authority when chosen.

Regeneration distinguishes material to revise from a prior attempt to avoid. Fresh alternatives receive the prior attempt with different framing and higher sampling temperature: almost identical request bytes previously produced almost identical drafts. Generic prose examples are avoided because they anchor style unintentionally; writer-curated voice samples are the deliberate exception.

## Selection Rewrite

Rewrite is an insertion mode, allowing either regeneration strategy. The selected span appears both as replacement material and bracketed in its manuscript context. A scene-closing selection may still close the scene after rewriting; ordinary continuation's anti-closure rule must not distort its shape.

A rewrite holds an immutable baseline of editor state, exact selection, Markdown, history, and insertion context while the preview displaces the text. The editor stays locked until acceptance or rejection, including after Stop, errors, or incomplete output. Autosave reads the original Markdown even during unmount cleanup, preventing a displaced selection from being saved as a deletion.

Reject restores that baseline. Accept restores it before applying one committed replacement, preserving boundary whitespace and formatting. Preview updates stay out of undo history, and acceptance becomes one undoable edit. Restoring captured history prevents rejected previews from resurfacing; late callbacks from stopped/resolved requests are ignored. Failed acceptance preserves both the draft and original manuscript.

## Stream Completion

Only a normal `stop` finish emits successful completion. Output limits, filtering, missing terminal events, and unexpected finishes cannot masquerade as success. Prose retains partial output for writer review with a sanitized explanation; Stop and operational errors remain distinct. Chat has a separate bounded tool-stream protocol: tool calls/results are intermediate steps, and only normal final completion can stage a reply or actionable proposal. Interrupted or incomplete generations cannot be finalized as successful replies.

## Prompt Inspection

Exact prompt snapshots are ephemeral, server-memory debugging aids. They expire and disappear on restart; they are not durable manuscript history. Never log their prompt bodies, manuscript text, or generated prose.

## Provider Notes

Prose normally disables reasoning, but GLM 5.3 requires it. Its smallest supported effort is `low`, verified against [OpenRouter metadata](https://openrouter.ai/api/v1/models) and the [model page](https://openrouter.ai/z-ai/glm-5.3) on 2026-10-06. Excluding reasoning from returned content does not eliminate its billing or completion-token cost; see [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Reserved output headroom is not a hard cap on hidden reasoning. Chat retains provider defaults.

Mistral Large 4.0 replaces Medium 3.5 following verification on 2026-10-08. Its exact ID has two [ZDR-listed endpoints](https://openrouter.ai/api/v1/endpoints/zdr): `mistral/eu` with 524,288 context tokens and `mistral/zdr` with 1,048,576; both allow 262,144 completion tokens. Although the [model catalog](https://openrouter.ai/api/v1/models) advertises 1,048,576 context tokens, LocalInk uses 524,288/262,144 context/completion limits so either eligible endpoint can serve the request without provider pinning. The [model endpoints](https://openrouter.ai/api/v1/models/mistralai/mistral-large-4-0/endpoints) and model metadata were checked together; reasoning is optional and supports `high` and `none`, so prose retains `NO_REASONING`.

Exact-ID ZDR checks on 2026-10-06 found 15 eligible endpoints for `deepseek/deepseek-v4-pro-0813`, 21 for `moonshotai/kimi-k3`, and 33 for `z-ai/glm-5.3`; the Mistral check above is dated 2026-10-08. These are historical verification results, not a live availability guarantee.

All four keep default ZDR routing with no exemption or provider pinning. Loss of all eligible endpoints surfaces as `AI_ZDR_UNAVAILABLE`, without fallback to a retaining provider. Each profile's prose context limit is enforced against the assembled prompt and reserved output.

Every OpenRouter text call requires ZDR routing, including background summaries and image-prompt enhancement. The per-request flag combines with account policy by tightening it, never loosening it. No eligible endpoint must surface as `AI_ZDR_UNAVAILABLE` rather than falling back to a retaining provider.

The recorded provider checks found ZDR endpoints for `deepseek/deepseek-v4-pro-0813` but not at first-party DeepSeek, the endpoint with implicit prompt caching. Choosing ZDR therefore sacrifices that caching and can change latency, cost, and quantization for long manuscript requests. Recheck each exact model ID before changing it: matching display names can mix dated variants, and endpoint eligibility changes over time.

Keep text-generation call sites’ `LocalinkProviderOptions` (`src/lib/ai.ts`) limited to `reasoning`: the OpenRouter AI SDK provider spreads `providerOptions.openrouter` over the request body and replaces `provider` wholesale rather than merging it, so a caller passing `openrouter.provider` through that option would silently drop the pinned ZDR routing. Do not add a `provider` key to per-call `providerOptions`.
