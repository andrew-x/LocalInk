# AI Prose Generation

LocalInk's prose generation should help the writer draft fiction while preserving manual control and insertion fidelity. The app's local-first privacy guarantees are enforced by data handling and logging rules; model-facing prose prompts should spend attention on generation quality, manuscript continuity, and the current request rather than product identity or privacy statements.

## Generation Goals

- Produce grounded, immersive adult fiction prose that reads as part of the user's current manuscript rather than generic assistant output.
- Favor authentic character behavior, specific sensory grounding, natural causality, and dialogue shaped by character voice, relationship, and scene pressure.
- Be assertive about drafting complete prose when asked. Avoid apology-first, meta, or workshop-style responses unless the workflow explicitly requests analysis.
- Keep the writer in control. Generation creates a draft candidate; the user decides whether to insert, regenerate, revise, or discard it.
- Preserve insertion fidelity. Generated text should respect the selected insertion point, surrounding prose, current POV, tense, style, continuity, and requested boundaries.
- Regeneration should produce a meaningfully new candidate while keeping the same user intent, project context, insertion point, and continuity constraints.

## Prompt Contract

The prose prompt architecture separates durable generation behavior from request-specific instructions:

- System prompt: stable prose-generation contract, output discipline, hierarchy rules, craft defaults, and model behavior constraints.
- Request prompt: the user's current task, insertion target, scene/project context, selected references, and soft length target.

Do not mention LocalInk, local-first behavior, or private-data handling in the model-facing prose prompt. Those details are important application constraints, but they do not improve prose quality and can distract from the writing task.

Use explicit XML-style tags around major prompt sections and structured values so models can distinguish instructions, metadata, full manuscript context, insertion anchors, and the user request. Treat tags as structure for model attention and injection resistance, not as content to reproduce. Escape user-provided text inside XML-style fields so manuscript text and writer instructions cannot accidentally create or close prompt tags.

The active generation instructions should be XML fields, not prose labels. Put the creative brief, regeneration mode, regeneration edit instructions, continuation bias, insertion mode, length target, final output constraints, and final before-text reminder in explicit tags such as `<ACTIVE_GENERATION_INSTRUCTIONS>`, `<CREATIVE_BRIEF>`, `<REGENERATION_EDIT_INSTRUCTIONS>`, `<OUTPUT_DISCIPLINE>`, and `<CLOSING_BEFORE_INSERTION>`. Repeat the active generation instructions near the beginning of the request and again inside the final request so the current brief stays salient after long manuscript context; this duplication is intentional bookending, while the top-only instruction authority remains the source of precedence.

Do not emit blank optional values into prompts. Omit absent descriptions, style guides, character notes, chapter text, and insertion anchors instead of adding placeholder text like "No text after insertion point." Insertion anchors and metadata should be represented as XML-style fields such as `<BEFORE_INSERTION>`, `<AFTER_INSERTION>`, and `<CHAPTER_METADATA>` so they are not mistaken for prose to continue.

The prompt should repeat the highest-priority beginning and ending instructions when the request is long. This is intentional attention-aware design for long-context behavior: models often weight the start and end of context more reliably than the middle.

## Context Hierarchy

Generation context should be ordered by authority and usefulness:

1. Stable output discipline and prose-quality constraints.
2. The current user request and explicit writing goal, repeated in XML near the beginning and end of the request prompt.
3. Insertion anchors and immediate manuscript surroundings.
4. Explicit story premise, character notes, and style guide.
5. Full manuscript content across the story's chapters, ordered by chapter position, with each chapter labeled as before, focused, or after the insertion point.

For now, prose generation should not depend on indexed chapter summaries or retrieved chunks. The request prompt should include the story's chapter manuscript text directly, with the focused chapter snapshot reflecting the current editor content at generation time. Full-manuscript generation has a hard aggregate chapter-text size guard; if the story crosses it, the app should return a clear prompt-size error instead of sending an oversized request to the model.

For insertion tasks, use distinct insertion reminders at different scopes instead of repeating large overlapping windows: a tight top anchor with the last local paragraph before insertion and first sentence after insertion, an `<INSERTION_POINT/>` marker inside the focused chapter's `<CHAPTER_TEXT>` in `<FULL_STORY_MANUSCRIPT>`, and a short `<CLOSING_BEFORE_INSERTION>` snippet near the final request. This helps preserve continuity at the exact edit point and reduces drift when the prompt contains many references without making duplicated anchor sections load-bearing.

## Drafting Behavior

- Generate prose only, unless the workflow asks for notes or alternatives.
- Match the surrounding manuscript's tense, POV, person, paragraph rhythm, scene distance, and dialogue formatting.
- Prefer specific action, perception, implication, and character choice over explanation. Use "show, don't tell" as a craft bias, not a ban on interiority or exposition.
- Dialogue should sound like characters under pressure pursuing goals. Avoid interchangeable voices, over-explaining subtext, and dialogue that exists only to summarize plot.
- Use adult-fiction confidence: when the request calls for vivid, emotionally direct, or intense prose, draft it plainly within the user's stated boundaries instead of softening into generic or instructional language.
- Respect soft length targets. Aim for the requested scale, but prioritize clean insertion boundaries, forward motion, and prose quality over exact token or word counts.
- Default to open-ended continuation. The writer builds the manuscript one generation at a time, so generated prose should not conclude the story, chapter, scene, or current dramatic beat unless the current request explicitly asks for an ending.
- Avoid embedding generic prose examples in the prompt contract. Examples can cause style anchoring and make outputs sound less like the user's manuscript.

## Prompt Inspection

Each generated draft version can reference an ephemeral server-side snapshot of the exact system and request prompts used for that version. The inline draft review UI may fetch that snapshot on demand for inspection. Prompt snapshots are for manual debugging and prompt iteration; do not log prompt bodies, manuscript text, or generated prose.

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
