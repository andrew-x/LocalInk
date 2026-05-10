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

The active generation instructions should be XML data fields, not prose labels. Put dynamic values such as the generation mode, creative brief, regeneration edit instructions, insertion mode, length target, and final before-text reminder in explicit tags such as `<ACTIVE_GENERATION_INSTRUCTIONS>`, `<GENERATION_MODE>`, `<CREATIVE_BRIEF>`, `<REGENERATION_EDIT_INSTRUCTIONS>`, `<TARGET_WORD_COUNT>`, and `<CLOSING_BEFORE_INSERTION>`. Repeat the active generation instructions near the beginning of the request and again inside the final request so the current brief and mode stay salient after long manuscript context; this duplication is intentional bookending, while the system prompt remains the source for durable instruction authority. Do not duplicate the same value under different tags (for example, do not emit both `<GENERATION_MODE>` and a parallel `<REGENERATION_MODE>` carrying the same value).

Do not emit blank optional values into prompts. Omit absent descriptions, style guides, character notes, location notes, chapter text, and insertion anchors instead of adding placeholder text like "No text after insertion point." Insertion anchors and metadata should be represented as XML-style fields such as `<BEFORE_INSERTION>`, `<AFTER_INSERTION>`, and `<CHAPTER_METADATA>` so they are not mistaken for prose to continue.

The request prompt should repeat the highest-priority dynamic data when the request is long. This is intentional attention-aware design for long-context behavior: models often weight the start and end of context more reliably than the middle.

## Context Hierarchy

The system prompt should define how dynamic request context is ordered by authority and usefulness:

1. Stable output discipline and prose-quality constraints.
2. The current user request and explicit writing goal, repeated in XML near the beginning and end of the request prompt.
3. Insertion anchors and immediate manuscript surroundings.
4. Full manuscript content across the story's chapters, ordered by chapter position, with each chapter labeled as before, focused, or after the insertion point.
5. Explicit story premise, character notes, location notes, and style guide as supporting context when they do not contradict the current manuscript state.

Prose generation uses full chapter manuscript content directly. The request prompt includes each chapter's text as dynamic data, with the focused chapter snapshot reflecting the current editor content at generation time. Story-level style, character, and location context are included as structured XML sections before the manuscript. There is no indexing, embedding, or chunk-retrieval pipeline. Full-manuscript generation has a hard aggregate chapter-text size guard; if the story crosses it, the app returns a clear prompt-size error instead of sending an oversized request to the model.

The model-facing prompt should tell the model to read the full manuscript as a timeline, not as isolated facts. Details from early chapters may have been revised, resolved, contradicted, transformed, or made obsolete by later chapters, so continuation should use the current story state at the insertion point while still remembering unresolved promises, injuries, objects, relationships, plans, mysteries, and consequences that remain active.

When notes conflict with manuscript content, the manuscript wins for canon and continuity. Notes can still win for reusable craft guidance such as voice, descriptive priorities, character handling, and location texture when they are more specific than diffuse manuscript cues and do not contradict current story state.

For insertion tasks, the request prompt should include distinct dynamic insertion reminders at different scopes instead of repeating large overlapping windows: a tight top anchor with the last local paragraph before insertion and first sentence after insertion, an `<INSERTION_POINT/>` marker inside the focused chapter's `<CHAPTER_TEXT>` in `<FULL_STORY_MANUSCRIPT>`, and a short `<CLOSING_BEFORE_INSERTION>` snippet near the final request. Static instructions for interpreting those fields belong in the system prompt. This helps preserve continuity at the exact edit point and reduces drift when the prompt contains many references without making duplicated anchor sections load-bearing.

## Chat Context

Story chat does not include story description, manuscript text, chapter summaries, or retrieved excerpts in its hidden context snapshot. It includes only story-level style guidance, character notes, and location notes, all escaped in XML-style sections. The chat system prompt and slash-command prompts tell the model to use those notes without inventing missing canon from them.

Slash commands expand only when the latest visible user message starts with a known command. `/style` drafts paste-ready style guidance, `/character` drafts one paste-ready character description, and `/location` drafts one paste-ready location description.

## Drafting Behavior

- Generate prose only, unless the workflow asks for notes or alternatives.
- Match the surrounding manuscript's tense, POV, person, paragraph rhythm, scene distance, and dialogue formatting.
- Prefer specific action, perception, implication, and character choice over explanation. Use "show, don't tell" as a craft bias, not a ban on interiority or exposition.
- Dialogue should sound like characters under pressure pursuing goals. Avoid interchangeable voices, over-explaining subtext, and dialogue that exists only to summarize plot.
- Match the manuscript's language variety, spelling, grammar, idiom, and colloquial register. Prefer active voice, fresh specific phrasing, varied sentence rhythm, and lean dialogue that changes the scene's pressure or direction.
- Format each speaker's dialogue in its own paragraph. Use unobtrusive tags or purposeful action beats for clarity, but avoid repetitive tags, empty facial-expression beats, filler words, weak adverbs, cliches, and hedging that blurs intent.
- Use adult-fiction confidence: when the request calls for vivid, emotionally direct, or intense prose, draft it plainly within the user's stated boundaries instead of softening into generic or instructional language.
- Respect soft length targets when present. Aim for the requested scale, but prioritize clean insertion boundaries, forward motion, and prose quality over exact token or word counts. For unbounded generation, impose no artificial target and stop once the requested beat is satisfied.
- Follow the current beat instructions closely and leave the passage open for the next generation. Closure, foreshadowing, teaser lines, and ominous setup are written only when the current request explicitly asks for them; the writer builds the manuscript one generation at a time.
- Continue logically from what has happened so far. Track character knowledge, emotional state, logistics, resources, and unresolved consequences so details mentioned earlier are neither forgotten nor incorrectly treated as unchanged after the story has moved past them.
- Avoid embedding generic prose examples in the prompt contract. Examples can cause style anchoring and make outputs sound less like the user's manuscript.

## Prompt Inspection

Each generated draft version can reference an ephemeral server-side snapshot of the exact system and request prompts used for that version. The inline draft review UI may fetch that snapshot on demand for inspection. Snapshots are stored in an in-process LRU cache (capacity 50, TTL 4 hours) and do not survive server restarts. Prompt snapshots are for manual debugging and prompt iteration; do not log prompt bodies, manuscript text, or generated prose.

## Provider Notes

Some providers expose reasoning or thinking modes that are useful for analysis but counterproductive for fiction drafting. For DeepSeek through OpenRouter, prose generation should use non-thinking behavior where available so the model spends output budget on the draft rather than hidden or visible reasoning. OpenRouter reasoning-token controls should be considered part of provider configuration, not user-facing draft content.

Provider-specific prompt shape may vary, but the generation contract should stay stable: prose-first output, clear context hierarchy, insertion fidelity, manual draft control, and high-quality fiction craft.

## Rationale Sources

The architecture is grounded in these source categories:

- DeepSeek thinking-mode behavior and recommendations for disabling thinking when direct prose output is preferred.
- OpenRouter reasoning-token controls and provider routing behavior.
- Long-context and lost-in-the-middle research showing that instruction placement and repeated salient anchors can affect retrieval and compliance.
- Fiction craft basics for scene grounding, character motivation, escalation, and specificity.
- Show-don't-tell guidance, applied as a practical bias toward dramatized evidence rather than abstract summary.
- Dialogue guidance focused on voice, subtext, goals, conflict, and avoiding exposition-heavy exchanges.
