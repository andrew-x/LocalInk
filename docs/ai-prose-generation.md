# AI Prose Generation

Generation produces writer-controlled draft candidates, with continuity and insertion fidelity taking priority over generic assistant output. Local-first privacy belongs in data handling and logging, not model-facing prose instructions that distract from the writing task.

## Prompt Contract

Stable behavior and instruction interpretation live in the system prompt; dynamic request values and manuscript context live in escaped XML-style fields. Escaping prevents user text from accidentally creating or closing structural tags. Omit blank optional fields rather than adding prose placeholders that could be mistaken for material to continue.

The current task is intentionally repeated near the beginning and end of long requests to keep it salient. Distinct short insertion anchors locate the edit without duplicating large overlapping manuscript windows. This bookending is intentional; duplicating the same value under competing tags is not.

Writer-authored story instructions are the exception to request-data placement: although supplied with each request, they are policy and enter the system prompt after global writer instructions, taking precedence as the more specific guidance. Story-specific guidance takes precedence over any potential cache reuse; provider caching must not determine the writer's instructions.

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

## Suggested Continuation Prompts

Ideas and their expansion are transient planning material, never manuscript canon or an accepted prose draft. The editor reads the current caret-or-chapter-end insertion context without creating a draft, moving selection, or adding undo history; it does not restore a remembered caret after focus changes. Selected-text rewrites and unresolved drafts are excluded. Requests include live unsaved manuscript Markdown, with summaries verified against that snapshot through the same provenance and context-budgeting helpers as prose generation. Planning has its own instructions so prose-only output rules do not leak into the shortlist or editable prompt.

A shortlist retains its captured context for expansion. Before using or applying a result, compare actual manuscript, insertion anchors, references, writing settings, and typed guidance; synopsis refreshes alone do not invalidate it. Cancellation and superseded requests cannot apply late results. Expansion changes only the editable prompt, with the prior input recoverable through Undo; continuing the story still requires the writer's submission.

Suggestions and expansion use the shared default Flash profile, independently of the prose and chat model selectors. The shortlist uses schema-validated structured output; both stages require normal completion. There is no main/fast role split, model fallback, or acceptance of truncated output.

## Chat Context

Chat supports planning, drafting reusable story references, and proposing manuscript or story-detail edits. Each turn captures an immutable manuscript snapshot, including unsaved editor Markdown and the active selection. Unaccepted prose previews contribute their original manuscript, not preview text. Story title, description, instructions, style, voice samples, characters, backstory, and locations come from an immutable saved-detail snapshot; open, unsaved detail forms are excluded. There is no separate outline field. Saved instructions are editable references here, not authority over chat output format. Voice examples contribute register, not facts or wording to recycle.

The initial prompt includes the active chapter, chapter catalog, and provenance-verified summaries. Bounded read/search tools access other chapters from that same snapshot, so later typing cannot silently change a tool's source. Context accounting includes history, tool inputs/results, and output/reasoning allowances. Reduction removes whole lower-priority context units and identifies omissions; edit targets must be read as exact text rather than inferred from summaries. Oversized protected context fails instead of silently truncating the requested edit. Full-book snapshots are temporary; durable proposals retain only affected chapter baselines and results.

Field-drafting commands use accepted discussion decisions and saved references, with current corrections taking priority. Rejected branches and unconfirmed suggestions must not become canon. Historical commands are not re-expanded; shared guidance remains active for ordinary clarification answers and revisions. Only a voice demonstration permits a minimally invented non-canon situation. Commands produce copy-ready text unless the writer explicitly requests saving it, which prepares a proposal for approval rather than applying it automatically.

### Manuscript Proposal Safety

An edit tool constructs a proposal against exact, unambiguous spans in the captured manuscript; it cannot write chapters. Application approval deliberately happens outside the model's tool loop: approving an immutable stored result must not resume generation and produce different text. Chapter identity, titles, order, and chapter metadata remain read-only. Proposal statuses enter later conversation context, while each new turn reads the manuscript afresh; pending, denied, and undone edits are not canon. Earlier proposal text can be retrieved for follow-up discussion as historical reference, never as a substitute for reading current edit targets.

Completed replies and proposals are staged in bounded, expiring server memory before a separate action persists them together. A completed stream alone is not durable: expiry or a server restart before finalization requires regeneration. Finalization retries return an already-persisted generation and cannot substitute browser-supplied edit content. Pending proposals survive reload only after finalization. Proposal-bearing replies cannot be regenerated in place because doing so would erase decision and Undo history; ask for a revised proposal in a new message.

Approval and Undo first pause affected editors, drain pending saves, and flush unsaved writing. Active prose drafts block resolution. Chapter saves use revision-based compare-and-swap, and resolution checks exact chapter bodies as well as revisions inside one transaction. A changed or deleted chapter rejects the entire operation rather than partially applying edits or overwriting newer writing. Undo restores the original chapters only while every affected chapter still matches the accepted result; it does not merge subsequent writing.

An autosave failure pauses its queue and preserves local writing. Retry repeats the uncertain write with its original revision before sending newer text; an identical already-saved body succeeds safely, but a true conflict never silently adopts another tab's revision. Copy unsaved writing before reloading to reconcile a conflict.

Committed results are imported with an explicit history boundary and autosave suppression before editors resume. Markdown must round-trip through the editor without losing formatting. If importing a committed result fails, editors stay paused for saved-content recovery. Lost resolution responses are reconciled against durable proposal status before saves resume; repeating a decision must never apply or reverse it twice.

### Story-Detail Proposal Safety

`read_story_details` reads saved fields from the turn's immutable snapshot; every affected field must be read before `propose_story_details_edits` can prepare edits. This includes the story title, description, characters, locations, backstory, style, instructions, and voice samples. Collection edits target individual characters, locations, or voice samples by stable ID, with explicit additions, updates, and removals; text fields still use replacement values. A reply can prepare one proposal total, either manuscript or details. Requests spanning both need separate replies so each approval has one clear scope.

Detail proposals use separate durable records with pending, accepted, rejected, and undone states, finalized together with the assistant reply through the same server-staging boundary. Pending, rejected, and undone details are not canon. A scoped, paginated historical reader exposes exact proposal values for follow-up revisions without satisfying the requirement to read current fields. Approval compares the targeted entry or text field against its exact baseline and applies all edits in one transaction; Undo requires those same targets to still match the accepted result. Other entries can change without blocking approval or Undo, and their current values are preserved. A conflicting target or exceeded collection limit rejects the entire operation. Existing entity IDs survive edits, and the server assigns IDs to new entries. Older saved proposals retain their whole-field conflict and replacement behavior because that is the scope originally presented for approval.

Resolution refreshes saved story context without replacing manuscript editor contents. Open detail forms must detect changed saved values before submitting, so an older form cannot silently overwrite an approved proposal.

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

Text calls use Venice directly with server-side `VENICE_API_KEY`, except Mistral Large 4, which uses OpenRouter with server-side `OPENROUTER_API_KEY`. Prose and chat have independent model choices; synopses, continuation suggestions/expansion, and image-prompt enhancement always use the default DeepSeek Flash profile. Central profiles keep context limits, completion ceilings, and reasoning settings together so prose and chat budget the same selected endpoint. Task-specific output and sampling settings remain separate from model selection.

Story Studio has no model pickers. Prose (beats, scene drafts, the chat's prose tool, selection rewrites, voice samples and tune rewrites) always uses DeepSeek V4 Pro; planning, chat, read-back, and other assist work use Flash 1017 Uncensored (`src/lib/studio/models.ts`). Studio output caps are runaway guards, not length limits: the prompt sets length, and a `length` finish discards the result, so a cap near the expected length only turns good output into an error (Pro runs 30-50% past word targets compared with Flash, tested 2026-11-05). Streamed beats use the model's ceiling, since Stop ends a runaway; non-streamed calls (voice samples, rewrites, planning, read-back) keep caps several times their largest real output because nothing can stop them early. The old `prose_model`/`chat_model` columns on `studio_stories` are unused but kept, because dropping them would make drizzle-kit rebuild the table (see [Story Studio](story-studio.md)).

The five Venice IDs were checked against Venice's [text catalog](https://api.venice.ai/api/v1/models?type=text) on 2026-10-28. All five supported function calling and response schemas. Both DeepSeek choices, Grok 4.7, and GLM 5.3 were classified **Private**; Kimi K3.1 Pro was **Anonymized**. Kimi is a deliberate exception approved for manuscript use and labeled in both selectors. These are dated capability checks, not availability guarantees.

Venice's [privacy modes](https://docs.venice.ai/overview/privacy) differ: Private promises inference-only processing with no retained prompt/response content, while Anonymized obscures account identity but allows the upstream provider to see prompt content. Using Venice does not make every model Private. Local storage and sanitized logging do not extend the provider's privacy guarantee. Requests never fall back to another model or provider.

On 2026-10-31, Venice’s catalog reconfirmed that Flash Uncensored and `deepseek-v4-pro-0813` are available and Private. OpenRouter’s [ZDR catalog](https://openrouter.ai/api/v1/endpoints/zdr) listed the exact `mistralai/mistral-large-4-0` ID on `mistral/zdr` and `mistral/eu`. Requests pin `mistral/zdr`, enforce `provider.zdr: true`, require supported parameters, and disable provider fallbacks. The pinned endpoint’s 1,048,576-token context and 262,144-token completion limits match the shared profile; the EU endpoint has a smaller context. If the eligible endpoint is unavailable, generation fails rather than relaxing privacy or switching endpoints. See [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection). The model catalog advertises tools, structured outputs, and reasoning efforts `high`/`none`; LocalInk uses `none` for writing. These are dated catalog checks, not live generation guarantees.

On 2026-11-05, Venice's catalog listed both DeepSeek models as Private with 1,000,000-token context, function calling, response schemas, and reasoning efforts `none`/`low`/`high`/`max`. `deepseek-v4-pro-0813` now allows 262,144 completion tokens (the profile was raised from 32,768); Flash 1017 Uncensored is unchanged at 131,072.

Venice's added system prompt and web search are disabled so they cannot alter LocalInk's writing contract or introduce external context. Reasoning controls are model-specific: DeepSeek and Kimi support `none`; Grok uses its smallest supported effort, `low`; GLM omits an unsupported effort parameter. See [reasoning controls](https://docs.venice.ai/guides/features/reasoning-models). Reasoning content stays separate from visible prose; it still consumes completion tokens. Bounded Grok/GLM prose reserves additional headroom, which is an allowance rather than a hard hidden-reasoning limit. Length finishes remain incomplete output.

Changing providers does not invalidate synopsis provenance or rewrite saved chat/proposal history. Story model selection is transient UI state, not durable manuscript metadata.
