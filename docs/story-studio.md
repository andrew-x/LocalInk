# Story Studio

Story Studio is a planning-first writing mode: Bible, chapter/scene/moment plan, and per-moment prose, with AI that drafts, plans, and reads prose back. This explains the constraints behind it, not its schema or UI. Phase 1 covers the Bible, plan, manuscript, inspect panel, and read-back. Later phases: out-of-date/fingerprint tracking, review bundles, agent chat, and AI-ism detection. None of those exist yet, so do not assume them.

## Separate from existing stories

Studio has its own `studio_` tables and its own modules (`src/lib/studio`, `src/lib/server/studio`, `src/actions/studio`, `src/app/api/studio`, `src/components/studio`). It imports nothing from the story editor or story chat. The data model (plan tree, change records, per-moment prose) differs enough that sharing would couple two evolving features, and a deletion or migration in one must not touch the other. Where Studio mirrors an existing idea (for example markdown handling), it copies deliberately. Keep it that way.

## Story state is computed, not stored

A character or place has fixed details plus change records pinned to plan items. "State" at a point in the story is replayed on demand (`src/lib/studio/state.ts`). Snapshots are not stored, because every plan edit, move, split, merge, or delete would have to cascade through them.

The replay rule is easy to get wrong:

- Going into plan item P, a change counts only if its item has fully ended before P starts. Ancestors of P are excluded, even though they start earlier, because a scene's own changes happen during its moments.
- Coming out of P means going-in plus changes pinned to P and its descendants.
- `knows` and `note` accumulate. Every other aspect is latest-wins per entry and about-entry.
- Planned and confirmed changes both count, so state is useful before anything is written.

## AI boundary: routes generate, Actions persist

AI calls run in Route Handlers (`src/app/api/studio`) and stage their output in server memory (`src/lib/server/studio/staging.ts`). The author's click then calls a Server Action that persists the staged output by `generationId`.

- Server Actions dispatch sequentially per client. A long generation as an action would block autosave and every other save behind it. This is the carve-out described in `backend-actions.md`.
- The Action reads the staged result and never accepts AI text from the browser. Otherwise browser-supplied text could be stored as "AI output" and take the AI-owned code paths.
- Moment prose is staged only when the stream finishes with `stop` (`stageOnStop` in `route-kit.ts`). Truncated, filtered, or aborted drafts have nothing staged, so a partial draft cannot be kept.
- Staged results are volatile: 15 minute TTL, bounded count and bytes, and gone after a server restart. The user-facing recovery is to generate again.
- Undo-delete snapshots use a separate small pool (also 15 minutes, oldest evicted) so a delete never fails because generations fill the main pool. Undo does not survive a restart.

## Strict structured output

`@ai-sdk/openai-compatible` defaults `strictJsonSchema` to true. Strict mode rejects or mishandles schemas with optional fields, records, and length or count bounds. So the model-output schemas (`planning-contract.ts`, `read-back-contract.ts`, `rewrite-contract.ts`) make everything required or nullable and use no records or bounds. Limits such as "three options" or "80 word summary" go in the prompt, and are enforced after parsing by the normalize/clip steps. Do not add `.optional()`, `.max()`, or `z.record()` to a model-output schema. It will fail only at runtime, per provider.

## Manuscript: one Lexical editor per moment

Each moment has its own editor and its own compare-and-swap autosave. This gives exact prose-to-moment attribution (read-back, versions, and context all key off the moment) and independent revisions, so one slow save cannot fail another moment. The trade-off is that selection cannot span moments.

- Before drafting, the loop flushes every editor up to and including the target (`flushMomentEditors`). The route builds context from saved prose, and the previous moment's debounced autosave may not have fired.
- After any external load (split, merge, keep draft, restore version) the editor's undo history is cleared. Otherwise undo would resurrect text the server already replaced, and autosave would then save it again as a duplicate. Version history is the way back.

## Read-back

Read-back summarizes a moment and reconciles it against planned changes.

- Stale guard: applying a staged read-back compares its `sourceHash` with the hash of the current prose. If the author edited in between, nothing is applied.
- Skip rule: a new read-back runs only when the prose changed meaningfully since the last one (`isMeaningfulChange`: two or more sentences differ, or a quarter of the larger side). `force` bypasses it.
- It only auto-confirms changes that were planned. Anything the model finds that was not planned, or any planned change it cannot find, becomes a flag for the author to resolve. Read-back never invents records.
- Dismissed flags stay dismissed and block re-raising the same finding, so the author is not nagged.
- A summary-only update does not bump the plan item's revision. The author cannot edit the summary, so bumping would cause pointless CAS conflicts for concurrent field saves.

## Ownership of author text

Plan items list `authorFields`, and Bible fields carry `author`. AI apply paths skip or only fill around author-owned content. Initial planning fills only empty fields, and read-back never overwrites a protected plan field.

An explicit pick of an AI option (alternatives, rewrite-brief, or a selection rewrite) counts as the author's approval. It may overwrite what the author wrote, and for plan briefs it then marks those fields as author-owned. Change records with `authorEdited` are never modified by read-back, including when they are matched or moved from the parent scene.

## Concurrent field saves

Inspect-panel saves go through per-record queues (`revision-slots.ts`). Each save waits for the previous save on the same record and uses the newest revision returned. Without this, two quick edits to different fields of one record would both send the same `expectedRevision`, and the second would fail as a conflict the author did not cause.
