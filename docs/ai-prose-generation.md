# AI Prose Generation

LocalInk's prose generation should help the writer draft fiction while preserving manual control and insertion fidelity. The app's local-first privacy guarantees are enforced by data handling and logging rules; model-facing prose prompts should spend attention on generation quality, manuscript continuity, and the current request rather than product identity or privacy statements.

## Generation Goals

- Produce grounded, immersive adult fiction prose that reads as part of the user's current manuscript rather than generic assistant output.
- Favor authentic character behavior, specific sensory grounding, natural causality, and dialogue shaped by character voice, relationship, and scene pressure.
- Be assertive about drafting complete prose when asked. Avoid apology-first, meta, or workshop-style responses unless the workflow explicitly requests analysis.
- Keep the writer in control. Generation creates a draft candidate; the user decides whether to insert, regenerate, revise, or discard it.
- Preserve insertion fidelity. Generated text should respect the selected insertion point, surrounding prose, current POV, tense, style, continuity, and requested boundaries.
- Preserve whole-story continuity. Generated text should follow the manuscript's chronological cause-and-effect flow, carry forward relevant details, and continue from the latest established story state rather than resetting to outdated earlier information.
- Regeneration should produce a meaningfully new candidate while keeping the same user intent, project context, insertion point, and continuity constraints.

## Prompt Contract

The prose prompt architecture separates durable generation behavior from request-specific instructions:

- System prompt: stable prose-generation contract, hard output rules, instruction precedence, story continuity discipline, dynamic-request interpretation rules (including a legend for enum field values), generation discipline (scope, task mechanics, and output discipline merged), style and line discipline, craft defaults, and model behavior constraints.
- Request prompt: dynamic request data only, including the user's current task values, insertion target, scene/project context, selected references, manuscript text, regeneration data, and soft length target.

Keep static instructions in the system prompt. The request prompt should not carry durable policy blocks such as context hierarchy, output discipline, continuation policy, regeneration policy, or prose craft rules. It should provide XML-structured data fields for the system prompt to interpret, such as `<TARGET_WORD_COUNT>`, `<INSERTION_MODE>`, `<GENERATION_MODE>`, `<CREATIVE_BRIEF>`, `<REGENERATION_EDIT_INSTRUCTIONS>`, `<CLOSING_BEFORE_INSERTION>`, and story/manuscript context fields. Field values should be short canonical tokens (for example `first-generation`, `revise-prior-draft`, `append-to-focused-chapter-end`, or a single integer); their meanings are defined once in the system prompt. Omit `<TARGET_WORD_COUNT>` for unbounded generation.

Do not mention LocalInk, local-first behavior, or private-data handling in the model-facing prose prompt. Those details are important application constraints, but they do not improve prose quality and can distract from the writing task.

Use explicit XML-style tags around major prompt sections and structured values so models can distinguish instructions, metadata, full manuscript context, insertion anchors, and the user request. Treat tags as structure for model attention and injection resistance, not as content to reproduce. Escape user-provided text inside XML-style fields so manuscript text and writer instructions cannot accidentally create or close prompt tags.

The active generation instructions should be XML data fields, not prose labels. Put dynamic values such as the generation mode, creative brief, pacing mode, beat goal, regeneration edit instructions, insertion mode, length target, and final before-text reminder in explicit tags such as `<ACTIVE_GENERATION_INSTRUCTIONS>`, `<GENERATION_MODE>`, `<CREATIVE_BRIEF>`, `<PACING_MODE>`, `<BEAT_GOAL>`, `<REGENERATION_EDIT_INSTRUCTIONS>`, `<TARGET_WORD_COUNT>`, `<TARGET_SCALE>`, and `<CLOSING_BEFORE_INSERTION>`. Repeat the active generation instructions near the beginning of the request and again inside the final request so the current brief and mode stay salient after long manuscript context; this duplication is intentional bookending, while the system prompt remains the source for durable instruction authority. Do not duplicate the same value under different tags (for example, do not emit both `<GENERATION_MODE>` and a parallel `<REGENERATION_MODE>` carrying the same value).

Durable per-story preferences are the one exception to "request data stays in the request prompt": `<STORY_SYSTEM_INSTRUCTIONS>` travels with the request payload but is writer-authored policy, not per-request data, so it is rendered into the *system* prompt as `<STORY_INSTRUCTIONS>`, immediately after the app-wide `<SYSTEM_INSTRUCTIONS>` (writer global system instructions), and wins over it as the more specific of the two. This makes the system prompt vary per story, which is an acceptable cost because ZDR routing already forfeits the main model's implicit prompt caching on this route (see Provider Notes).

Do not emit blank optional values into prompts. Omit absent descriptions, style guides, character notes, location notes, chapter text, and insertion anchors instead of adding placeholder text like "No text after insertion point." Insertion anchors and metadata should be represented as XML-style fields such as `<BEFORE_INSERTION>`, `<AFTER_INSERTION>`, and `<CHAPTER_METADATA>` so they are not mistaken for prose to continue.

The request prompt should repeat the highest-priority dynamic data when the request is long. This is intentional attention-aware design for long-context behavior: models often weight the start and end of context more reliably than the middle.

## Context Hierarchy

The system prompt defines an instruction precedence order, collapsed from nine levels to six, with writer voice promoted to fourth — above the app's own generation discipline and craft defaults, so a story's voice instructions and samples do not have to out-rank house prose rules to win:

1. Hard output rules.
2. Insertion boundaries and immediate manuscript continuity.
3. Current generation or regeneration instructions.
4. Writer voice: story system instructions, writer global system instructions, voice exemplars, story style guide, and character/location notes.
5. Full-story continuity and current story state.
6. Generation discipline, style and line discipline, and craft defaults.

Previously, story style guide and character/location notes sat seventh of nine, below the app's own craft opinions; voice now wins over them by design.

Prose generation uses full chapter manuscript content directly, though a chapter's full text degrades to its synopsis alone once the story is long enough (see Context Degradation below). The request prompt includes each chapter's text or synopsis as dynamic data, with the focused chapter snapshot reflecting the current editor content at generation time. Story-level style, character, and location context are included as structured XML sections before the manuscript. There is no indexing, embedding, or chunk-retrieval pipeline — degradation is a position-based budget, not retrieval. Full-manuscript generation still has a hard aggregate chapter-text size guard, `STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT` (`src/lib/server/story-prose-generation.ts`, now 1,500,000 characters, up from 300,000); if a story's total chapter text crosses it, the app returns a clear prompt-size error instead of sending an oversized request to the model. With degradation in play this is now a backstop against a pathological request rather than a wall a real manuscript is expected to reach.

The model-facing prompt should tell the model to read the full manuscript as a timeline, not as isolated facts. Details from early chapters may have been revised, resolved, contradicted, transformed, or made obsolete by later chapters, so continuation should use the current story state at the insertion point while still remembering unresolved promises, injuries, objects, relationships, plans, mysteries, and consequences that remain active.

Manuscript-versus-notes precedence now splits by kind. For canon, continuity, and mechanics (tense, POV, person, language variety, spelling, dialogue formatting), the manuscript wins when it conflicts with notes. For voice (register, diction, sentence shape, narrative distance), the manuscript is explicitly not the target: since roughly 99% of this user's manuscript is itself model-written, "match the surrounding prose" meant "match your own prior output" and compounded drift. Voice instead follows the writer's story and global system instructions, style guide, and pinned voice exemplars (below). Notes still win for descriptive priorities, character handling, and location texture beyond voice when they are more specific than diffuse manuscript cues.

For insertion tasks, the request prompt should include distinct dynamic insertion reminders at different scopes instead of repeating large overlapping windows: a tight top anchor with the last local paragraph before insertion and first sentence after insertion, an `<INSERTION_POINT/>` marker inside the focused chapter's `<CHAPTER_TEXT>` in `<FULL_STORY_MANUSCRIPT>`, and a short `<CLOSING_BEFORE_INSERTION>` snippet near the final request. Static instructions for interpreting those fields belong in the system prompt. This helps preserve continuity at the exact edit point and reduces drift when the prompt contains many references without making duplicated anchor sections load-bearing.

The focused chapter's `<CHAPTER_TEXT>` is captured as Markdown (via Lexical's `$convertSelectionToMarkdownString` over synthetic ranges in `chapter-ai-draft-plugin.tsx`), matching how every other chapter reaches the model as stored Markdown; a prior plain-text serialization of just the focused chapter silently dropped italics from the one chapter the model was continuing. Regeneration re-derives the before/after anchors from the draft node's current position in the document rather than reusing the snapshot captured at first generation, since that snapshot goes stale as soon as any chapter is edited afterward.

### Chapter Synopses

Each chapter can hold a background-generated synopsis (`chapters.synopsis`, `synopsisSourceHash`, `synopsisUpdatedAt`) that prose generation reads instead of re-deriving story state from raw text on every request. `refreshChapterSynopsis` (`src/actions/stories/refresh-chapter-synopsis.ts`) is a `publicActionClient` mutation that regenerates it with the `fast` model (`deepseek/deepseek-v4.1-flash`) via `generateStoryChapterSynopsis` (`src/lib/server/story-chapter-synopses.ts`), at a low temperature (0.2) so the same chapter tends to summarize the same way rather than varying creatively.

Staleness is decided by a SHA-256 hash of the chapter's content (`synopsisSourceHash`), not a timestamp, so a save that did not change the text costs nothing. Chapters under 600 characters are skipped — they are already their own best summary. The editor triggers a refresh fire-and-forget 10 seconds after a chapter's content settles (`chapter-content-editor.tsx`), skipping the call entirely if unsaved edits are still outstanding; the action itself re-checks the hash before calling the model, so a save that raced ahead of the timer is a no-op rather than wasted work.

Synopsis generation is deliberately not part of the prose request itself: the prose request never generates a synopsis inline, it reads whatever is stored and tolerates a stale one, which is what keeps drafting a single model call with no added latency.

### Story State

A `<STORY_STATE>` request section, placed after `<FULL_STORY_MANUSCRIPT>` and before `<FINAL_GENERATION_REQUEST>`, restates each chapter's synopsis up to and including the focused chapter. Placement follows the same lost-in-the-middle logic as voice exemplars below: the manuscript sits in the middle of a long prompt, where continuity facts are least reliably retrieved, so the story so far is restated in the high-attention tail. The manuscript wins on any disagreement, since the summary can lag a recent edit — the system prompt says so explicitly. Independent of `<STORY_STATE>`, each `<STORY_CHAPTER>` inside `<FULL_STORY_MANUSCRIPT>` also carries its own `<CHAPTER_SYNOPSIS>`.

### Context Degradation

`STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT` moved from 300,000 to 1,500,000 characters and changed role: with degradation in play it is a backstop against a pathological request, not a wall a real manuscript is expected to reach, because the per-request payload stays small regardless of story length.

Chapter text ships verbatim only until a 140,000-character budget (`FULL_TEXT_BUDGET_CHARS`, roughly 30-40k tokens) is spent, allocated outward from the insertion point by distance so the closest chapters are funded first. Once the budget runs out, a chapter falls back to its synopsis alone and is flagged `<CHAPTER_TEXT_INCLUDED>false</CHAPTER_TEXT_INCLUDED>` inside its `<STORY_CHAPTER>`. Two chapters on either side of the focused chapter always ship in full regardless of budget, since immediate neighbours carry the voice and cause-and-effect the next passage continues from. A chapter with no synopsis is never dropped even when the budget is spent — an unsummarized chapter would otherwise vanish from the model's view entirely, where a budgeted-out chapter with a synopsis is at least visible as a summary.

This is still position-based degradation, not retrieval: there is no indexing, embedding, or chunk-retrieval pipeline. Every chapter appears in `<FULL_STORY_MANUSCRIPT>` in story order; only its `<CHAPTER_TEXT>` is sometimes omitted in favor of its `<CHAPTER_SYNOPSIS>`.

### Voice Exemplars

A story can hold up to 3 pinned voice exemplars (`stories.voiceExemplars`, ≤4,000 characters each), emitted as a `<VOICE_EXEMPLARS>` request section placed after `<FULL_STORY_MANUSCRIPT>` and before `<FINAL_GENERATION_REQUEST>` — the part of a long context models weight most reliably, and framed as register to match rather than story to continue. They outrank the manuscript on voice and are explicitly non-canon. Sources are curation only: the "Pin voice" action on an accepted or reviewed draft (`chapter-ai-draft-plugin.tsx`), or pasted reference prose. Exemplars are never auto-selected from recent generated prose, which would freeze whatever drift has already accumulated into the anchor instead of correcting it.

This narrows the earlier "avoid embedding generic prose examples" guidance below: the concern was always *generic* examples causing style anchoring, not writer-chosen ones. Anchoring on a writer's own pinned passages is the goal, not the risk.

## Chat Context

Story chat does not include story description, manuscript text, chapter summaries, or retrieved excerpts in its hidden context snapshot. It includes only story-level style guidance, character notes, and location notes, all escaped in XML-style sections. The chat system prompt and slash-command prompts tell the model to use those notes without inventing missing canon from them.

Slash commands expand only when the latest visible user message starts with a known command. `/style` drafts paste-ready style guidance, `/character` drafts one paste-ready character description, and `/location` drafts one paste-ready location description.

## Drafting Behavior

- Generate prose only, unless the workflow asks for notes or alternatives.
- Mechanics follow the manuscript: tense, POV, person, language variety, spelling, grammar, and dialogue conventions (each speaker's dialogue in its own paragraph), unless the current instructions ask for a change.
- Voice does not follow the manuscript. Register, diction, sentence shape, and narrative distance follow the writer's current instructions, story and global system instructions, style guide, and pinned voice exemplars instead. Do not reuse distinctive phrasings, images, metaphors, gestures, or sentence shapes that already appear in the manuscript — repeated constructions read as tics, and treating existing model-written passages as a voice to imitate compounds drift rather than correcting it.
- Calibrate intensity to the actual stakes of the beat: quiet moments stay quiet, and heightened language, ornate description, and physiological extremity are reserved for beats that earn them. Default to a register slightly cooler than the emotion on the page and let the situation carry the weight.
- Cover the requested beat and nothing past it. Do not invent extra beats, outcomes, reversals, aftermath, foreshadowing, teaser lines, or ominous setup; treat the output as the middle of a longer passage, not a finished scene, and leave it open and continuable unless the current instructions explicitly ask for an ending, or the current insertion mode is a selection rewrite of a span that already closed the scene (see Selection Rewrite).
- Cut hedges and weak uncertainty markers (trying, maybe, seemed, almost, just, somehow) when they blur intent or action, along with filler words, repetitive dialogue tags, and facial-expression beats that don't change the action.
- Use adult-fiction confidence: when the request calls for vivid, emotionally direct, or intense prose, draft it plainly within the user's stated boundaries instead of softening into generic or instructional language.
- Respect soft length targets when present, alongside the `<TARGET_SCALE>` naming the scope that word count buys (200 → a single exchange or one continuous moment, 400 → a short beat, 600 → a full beat with a turn, 1000 → an extended sequence). Aim for the requested scale, but prioritize clean insertion boundaries, forward motion, and prose quality over exact word counts. Both are omitted for unbounded generation.
- Follow `<PACING_MODE>` when given — `scene` (real time, no compression), `summary` (compress elapsed time), `interior` (stay inside perception and physical reaction), or `dialogue` (drive the beat through speech) — and choose the movement the beat calls for when it is absent (`auto`, which emits no field). `<BEAT_GOAL>`, when the writer states one, names what should be different once the beat ends; pacing decisions hang on it.
- Continue logically from what has happened so far. Track character knowledge, emotional state, logistics, resources, and unresolved consequences so details mentioned earlier are neither forgotten nor incorrectly treated as unchanged after the story has moved past them.
- Avoid embedding generic prose examples in the prompt contract. Generic examples can cause style anchoring and make outputs sound less like the user's manuscript; writer-pinned voice exemplars are the deliberate exception (see Context Hierarchy).

The generic craft corpus that used to ship as hardcoded system-prompt rules was cut sharply: style/line discipline went from 11 bullets to 4, craft defaults from 6 to 1 (intensity calibration only, above), and generation discipline from 8 to 4 (three overlapping anti-closure rules collapsed to the one above). Restating workshop advice that models are already saturated with mostly amplified their default literary register, and over-stating anti-closure made a model circle a beat instead of moving through it. The removed guidance now ships as an opt-in "Default Craft" preset in the prompt library (`src/components/prompts/prompts-data.ts`), where pasting it into a story's instructions gives it writer authority instead of app authority.

Regeneration has two modes. `revise-prior-draft` carries the set-aside text as `<PRIOR_DRAFT_TEXT>` — editable material to output full replacement prose for. `fresh-alternative` instead carries it as `<PRIOR_ATTEMPT_TEXT>` in a `<PRIOR_ATTEMPT>` section: material to take a materially different approach from (entry point, structure, ordering, emphasis), not to revise or continue. The two use deliberately different tags because one is material to revise and the other is material to avoid. `fresh-alternative` also raises the sampling temperature by +0.13 over the active model profile's temperature (capped at 1); previously a fresh alternative was the same prompt bytes as the first attempt except one token, so it often returned near-identical prose.

## Selection Rewrite

Rewriting an existing selection is modeled as an insertion mode (`<INSERTION_MODE>replace-selected-text</INSERTION_MODE>`), not a generation mode, so it composes with regeneration: a rewrite draft can still be regenerated as a fresh alternative or revised with edit instructions. `describeInsertionMode` (`src/lib/server/story-prose-generation.ts`) selects this mode whenever the request's selected text is non-blank.

A `<SELECTION_TO_REWRITE>` request section carries the selected span as `<SELECTED_TEXT>`, with guidance that it is existing manuscript prose being replaced, not new material. Inside the focused chapter's `<CHAPTER_TEXT>`, `<SELECTION_START/>` and `<SELECTION_END/>` bracket the span in place instead of `<INSERTION_POINT/>`, so the model sees the selection in its surrounding context rather than only as a loose excerpt.

The anti-closure rule (see Drafting Behavior) has a carve-out for this mode: a rewritten span should match the shape the original had, so a span that closed a scene should still close it. The system prompt states this exception directly wherever it covers `<INSERTION_MODE>`.

In the editor (`chapter-ai-draft-plugin.tsx`), starting a rewrite calls Lexical's `insertNodes` on the current, non-collapsed selection, which removes the selected range before inserting the draft node — the draft visually stands in the place of the prose it will replace. Rejecting a rewrite restores the original text from a snapshot taken before the draft was inserted (`restoreRewriteSelection`, which replays the same splice `acceptDraft` uses to insert accepted text). This displacement happens inside an editor update tagged `AI_DRAFT_UPDATE_TAG`, which the autosave change listener explicitly ignores, so the mid-rewrite displaced state is never persisted to the chapter's saved content.

## Prompt Inspection

Each generated draft version can reference an ephemeral server-side snapshot of the exact system and request prompts used for that version. The inline draft review UI may fetch that snapshot on demand for inspection. Snapshots are stored in an in-process LRU cache (capacity 50, TTL 4 hours) and do not survive server restarts. Prompt snapshots are for manual debugging and prompt iteration; do not log prompt bodies, manuscript text, or generated prose.

## Provider Notes

Some providers expose reasoning or thinking modes that are useful for analysis but counterproductive for fiction drafting. Each story prose profile pairs its model with `NO_REASONING` (`reasoning: { effort: "none", exclude: true }`) so the model spends output budget on the draft rather than hidden or visible reasoning. OpenRouter reasoning-token controls should be considered part of provider configuration, not user-facing draft content.

Story prose model selection is a hand-swapped comparison, not a runtime setting. `STORY_PROSE_MODEL_PROFILES` in `src/app/api/story-prose/route.ts` pairs each candidate model with the sampling settings it should be judged at — model, temperature, and provider options together — because temperature is not portable between models; reading a model at another model's temperature misrepresents it. All four candidates currently share `temperature: 0.82` so the first comparison is like-for-like. The single swap point is the `ACTIVE_PROSE_MODEL` constant in that file: change which profile key it names, then restart the server. There is intentionally no runtime picker, app setting, or request field for this. The swap is scoped to prose only — story chat and image-prompt enhancement stay on the `main` role (`deepseek/deepseek-v4-pro-0813`) regardless of which prose profile is active, since they call `main` directly rather than through the prose registry.

The current prose candidates, with ZDR endpoint counts and context sizes verified 2026-09-21 against `https://openrouter.ai/api/v1/endpoints/zdr`:

| Profile key | Model | ZDR endpoints | Context |
| --- | --- | --- | --- |
| `deepseekV4Pro` (active) | `deepseek/deepseek-v4-pro-0813` | 6 | 1M |
| `kimiK3` | `moonshotai/kimi-k3` | 18 | 1M |
| `glm53` | `z-ai/glm-5.3` | 27 | 1M |
| `mistralMedium35` | `mistralai/mistral-medium-3-5` | 1 (Mistral first-party only) | 262k (209k max output) |

All four keep the default ZDR routing with no exemption or provider pinning needed. Mistral Medium 3.5's single endpoint means a Mistral outage surfaces as `AI_ZDR_UNAVAILABLE` with no reroute; its 262k context comfortably covers what a real request actually sends, since context degradation (see Context Degradation) keeps the per-request chapter-text payload to roughly the 140k-character full-text budget plus synopses regardless of story length — `STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT` itself is now a 1,500,000-character backstop, not the number to size a model's context window against. It replaced the originally requested Mistral Large 3: `mistralai/mistral-large-2512` has zero routable endpoints on OpenRouter and no ZDR listing, and its only resolving variant, `mistralai/mistral-large-2512:batch`, is a single non-ZDR asynchronous batch endpoint that cannot stream and so cannot serve this route at all. Re-check the ZDR endpoints list if Mistral later publishes non-batch endpoints for Large 3.

Every OpenRouter text call LocalInk makes — prose generation, story chat, and image-prompt enhancement — pins Zero Data Retention provider routing by default. `getLocalinkLanguageModel` in `src/lib/ai.ts` passes `provider: OPENROUTER_ZDR_PROVIDER_ROUTING` (`{ zdr: true }`) on every `.chat(...)` call, so this is not opt-in per request. OpenRouter ORs the per-request flag with the account-level setting, so it can only tighten routing, never loosen it; a model with no ZDR-listed endpoint answers `404` "No allowed providers are available for the selected model" instead of silently falling back to a retaining provider. `isOpenRouterZdrUnavailableError` in `src/lib/ai.ts` detects that condition so callers can surface `AI_ZDR_UNAVAILABLE` instead of a generic failure.

This has a real cost for the main model: `deepseek/deepseek-v4-pro-0813` has ZDR-listed endpoints at BaseTen, Fireworks, Novita, Phala, SiliconFlow, and Together, but not at first-party DeepSeek — which is also the only endpoint with implicit prompt caching for this model. ZDR routing therefore changes latency, cost, and quantization, and loses implicit caching on the long full-manuscript prose prompts described above. `fast` (`deepseek/deepseek-v4.1-flash`) is defined alongside `main` in `LOCALINK_AI_MODELS` and is no longer dormant: `generateStoryChapterSynopsis` (`src/lib/server/story-chapter-synopses.ts`) calls it for the background chapter synopsis generation described above (Chapter Synopses). It keeps the default ZDR routing like every other call site. Re-verified against `https://openrouter.ai/api/v1/endpoints/zdr` on 2026-09-21 when that call site was added: 18 ZDR endpoints (BaseTen, CoreWeave, DeepInfra, DigitalOcean, Fireworks, Makora, Modal, Morph, Novita, Parasail, Phala, Relace, Sail Research, SiliconFlow, Together, Venice, Wafer), up from the 7 recorded on 2026-09-11. The same check put `deepseek/deepseek-v4-pro-0813` at 17 endpoints rather than the 6 recorded earlier, so the counts in this file move around; re-check the endpoint list before changing any prose, main, or fast model ID. Note that the list keys on the exact `model_id`: matching on the `name` field instead picks up dated variants such as `deepseek/deepseek-v4-pro-20260813` and gives a misleading count.

`LocalinkProviderOptions` (`src/lib/ai.ts`) is intentionally kept to `reasoning` only: the OpenRouter AI SDK provider spreads `providerOptions.openrouter` over the request body and replaces `provider` wholesale rather than merging it, so a caller passing `openrouter.provider` through that option would silently drop the pinned ZDR routing. Do not add a `provider` key to per-call `providerOptions`.

Provider-specific prompt shape may vary, but the generation contract should stay stable: prose-first output, clear context hierarchy, insertion fidelity, manual draft control, and high-quality fiction craft.

## Rationale Sources

The architecture is grounded in these source categories:

- DeepSeek thinking-mode behavior and recommendations for disabling thinking when direct prose output is preferred.
- OpenRouter reasoning-token controls and provider routing behavior.
- Long-context and lost-in-the-middle research showing that instruction placement and repeated salient anchors can affect retrieval and compliance.
- Fiction craft basics for scene grounding, character motivation, escalation, and specificity.
- Show-don't-tell guidance, applied as a practical bias toward dramatized evidence rather than abstract summary.
- Dialogue guidance focused on voice, subtext, goals, conflict, and avoiding exposition-heavy exchanges.
