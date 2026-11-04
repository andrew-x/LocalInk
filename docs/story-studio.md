# Story Studio

Story Studio is a planning-first writing mode: characters and places, a chapter/scene/beat plan, and per-beat prose, with AI that drafts, plans, and reads prose back. The UI is two halves: a reading-first manuscript and a compact plan pane (Outline, Characters & places) with a docked AI box. This explains the constraints behind it, not its schema or UI. In the data model a "beat" is a `moment` plan item. Still not built, so do not assume them: out-of-date/fingerprint tracking (bundles compute no downstream out-of-date items) and AI-ism detection.

## Separate from existing stories

Studio has its own `studio_` tables and its own modules (`src/lib/studio`, `src/lib/server/studio`, `src/actions/studio`, `src/app/api/studio`, `src/components/studio`). It imports nothing from the story editor or story chat. The data model (plan tree, change records, per-moment prose) differs enough that sharing would couple two evolving features, and a deletion or migration in one must not touch the other. Where Studio mirrors an existing idea (for example markdown handling), it copies deliberately. Keep it that way.

## Story state is computed, not stored

A character or place has fixed details plus change records pinned to plan items. "State" at a point in the story is replayed on demand (`src/lib/studio/state.ts`). Snapshots are not stored, because every plan edit, move, split, merge, or delete would have to cascade through them.

The replay rule is easy to get wrong:

- Going into plan item P, a change counts only if its item has fully ended before P starts. Ancestors of P are excluded, even though they start earlier, because a scene's own changes happen during its moments.
- Coming out of P means going-in plus changes pinned to P and its descendants.
- Aspects are free-text labels, not a fixed list. Each change has a mode: `add` appends to a list (knowledge, secrets, promises), `set` replaces the value (latest wins per entry, normalized label, and about-entry). Labels are compared trimmed, space-collapsed, and lowercase; the most recent wording is displayed. Rows from before modes existed were back-filled: `knows` and `note` became `add`, everything else `set`.
- Planned and confirmed changes both count, so state is useful before anything is written.

Planned changes move down the tree as the plan gets finer. Because an ancestor's changes are excluded going into its descendants, a change left on a chapter is invisible to every moment inside it. So flesh-out shows the parent's planned changes with ids and each child returns `carriesChangeIds`; apply re-pins a carried change to that child (first claimant wins, `authorEdited` changes stay put) instead of creating a duplicate. Changes still on the scene or chapter reach the moment prompt only as "heading toward" context, never as the moment's required end state.

## AI boundary: routes generate, Actions persist

AI calls run in Route Handlers (`src/app/api/studio`) and stage their output in server memory (`src/lib/server/studio/staging.ts`). The author's click then calls a Server Action that persists the staged output by `generationId`.

- Server Actions dispatch sequentially per client. A long generation as an action would block autosave and every other save behind it. This is the carve-out described in `backend-actions.md`.
- The Action reads the staged result and never accepts AI text from the browser. Otherwise browser-supplied text could be stored as "AI output" and take the AI-owned code paths.
- Moment prose is staged only when the stream finishes with `stop` (`stageOnStop` in `route-kit.ts`). Truncated, filtered, or aborted drafts have nothing staged, so a partial draft cannot be kept.
- Staged results are volatile: they live 6 hours, each read pushes expiry back, and they are gone after a server restart. A draft or plan preview can sit on screen for a long time, which a short TTL broke. The pool is still bounded (50 entries, 64 MB); when it is full, the least recently touched finished result is evicted rather than refusing new work (abandoned drafts and unapplied plans would otherwise fill it). Running generations are never evicted. The user-facing recovery is to generate again.
- Undo-delete snapshots use a separate small pool (15 minutes, oldest evicted) so a delete never fails because generations fill the main pool. This undo does not survive a restart. Bundle undo is different: its data is stored in the persisted bundle op result and survives restarts (see Review bundles).

## Strict structured output

`@ai-sdk/openai-compatible` defaults `strictJsonSchema` to true. Strict mode rejects or mishandles schemas with optional fields, records, and length or count bounds. So the model-output schemas (`planning-contract.ts`, `read-back-contract.ts`, `rewrite-contract.ts`) make everything required or nullable and use no records or bounds. Limits such as "one rewrite" or "80 word summary" go in the prompt, and are enforced after parsing by the normalize/clip steps. Do not add `.optional()`, `.max()`, or `z.record()` to a model-output schema. It will fail only at runtime, per provider.

## Moment prompt context

Nothing writes chapter or scene summaries; read-back writes a summary per moment. So the "story so far" is every earlier written moment's summary (its brief until read-back has run), one unprotected section each, plus any chapter or scene summary. Under budget pressure the oldest summary is dropped first, then the next-moment set-up, then voice samples. The character and place entries, the brief, the scene and chapter descriptions, and the previous text are never dropped (the context-too-large error fires instead).

The beat prompt reads the enclosing scene's and chapter's `whatHappens` as `this_scene_in_the_authors_words` / `this_chapter_in_the_authors_words`, flagged `author="true"` when author-owned. Author-flagged text outranks AI scaffolding in the prompt's precedence. The scene and chapter descriptions are protected prompt sections because the outline is now the only place the author states direction, and a description dropped under budget pressure would silently ignore it. The character and place selection is the moment's present entries plus its scene's (a union), so a scene-level cast reaches every beat without per-beat bookkeeping. Manual pins and exclusions (`contextPinnedEntryIds`, `contextExcludedEntryIds`) are ignored but kept in the database, so the feature can come back without data loss. `how_to_write` was merged into `whatHappens` by migration 0014 for author-owned rows (AI-owned `how_to_write` is left in place), so author direction written there still reaches the prompt and still steers prose in upgraded stories.

## Scene drafts

Writing a scene drafts its beats in order and holds them as a draft over the manuscript until the author keeps or discards the whole scene.

- Each beat after the first is drafted against the earlier beats' unkept text. The client sends only the preceding beats' generation ids, never text; the route rebuilds the overlay from staging (same rule as the AI boundary). A missing stage returns 409 `DRAFT_EXPIRED` rather than drafting against a stale tail.
- `keepStudioSceneDraft` reads every stage first, then keeps all beats in one transaction, so a missing stage or one stale revision leaves the scene untouched. Stages are dropped only after commit, so a failed keep can be retried.
- Staging is volatile, so after a server restart every stage is gone. Redoing one beat cannot recover that (its earlier beats are missing too); only Try again, which redraws the scene, does. The UI wording points at Try again for that reason.
- Deleting a beat, or moving it out of the scene, drops only that beat from the draft. Each beat records which unkept beats it was drafted against (`basedOn`); a ready beat drafted against a dropped one is marked for a redo, so Keep waits until it is redone. A stream running on (or against) a dropped beat stops and the chain carries on with its remaining beats, unless an earlier beat now needs a redo, in which case it halts as Stop does.

## Manuscript: one Lexical editor per moment

Each moment has its own editor and its own compare-and-swap autosave. This gives exact prose-to-moment attribution (read-back, versions, and context all key off the moment) and independent revisions, so one slow save cannot fail another moment. The trade-off is that selection cannot span moments.

- Before drafting, the loop flushes every editor up to and including the target (`flushMomentEditors`). The route builds context from saved prose, and the previous moment's debounced autosave may not have fired.
- After any external load (keep draft, restore version) the editor's undo history is cleared. Otherwise undo would resurrect text the server already replaced, and autosave would then save it again as a duplicate. Version history is the way back.
- A failed save pauses that editor: it never retries with a newer revision on its own, so later edits to the beat are not saved until Retry. Because the text then exists only in the editor, the top bar counts paused beats with Retry, and closing or reloading the tab asks first while any beat is unsaved.

## Read-back

Read-back summarizes a moment and reconciles it against planned changes.

- Stale guard: applying a staged read-back compares its `sourceHash` with the hash of the current prose. If the author edited in between, nothing is applied.
- Skip rule: a new read-back runs only when the prose changed meaningfully since the last one (`isMeaningfulChange`). Changed sentences count as the larger of distinct sentences added and removed, so a one-sentence typo fix counts once; two or more, or a quarter of the longer version, is meaningful. `force` bypasses it (Keep, restore, and Re-read use it).
- It only auto-confirms changes that were planned: those on the moment, and unconfirmed ones on its scene or chapter, which are moved down to the moment. Anything the model finds that was not planned, or any moment-pinned change it cannot find, becomes a flag for the author to resolve. Read-back never invents records.
- Findings stay settled. The prompt lists each entry's state going in and the findings the author already settled, so restatements are not reported. After parsing, a finding is skipped when it matches a recorded change or a settled flag on the moment. For `set` changes the match ignores wording (one end state per entry, aspect, and about-entry per moment); for `add` changes it must be the same fact.
- "Settled" means dismissed, or resolved by recording it (the recorded change is still on the moment). An open unplanned flag that a new read-back does not report again with the same text is marked resolved as superseded, since it described prose that no longer exists. Superseded flags have no recorded change, so the finding can be raised again if the prose brings it back.
- Read-back fills a moment's title only when it is blank or the default and the author does not own it.
- A summary-only update does not bump the plan item's revision. The author cannot edit the summary, so bumping would cause pointless CAS conflicts for concurrent field saves.
- New people and places: read-back also lists named characters or places with no entry as suggestions (`studio_entry_suggestions`, not flags: flag kinds have a CHECK). Read-back still never creates entries; Add is the author's click, and it reuses an entry the author has since made with that name instead of adding a duplicate. The unique `(story_id, name_key)` spans every status, so an ignored or added name is never suggested again, and a stale read-back inserts none. That only holds while the row exists, so deleting the beat that introduced a name sets `moment_id` to null instead of cascading (migration 0016 rebuilt this table for it; nothing references it, so the rebuild is safe).

## Ownership of author text

Plan items list `authorFields`, and entry fields carry `author`. AI apply paths skip or only fill around author-owned content. Initial planning merges fields by normalized label (`mergeAiFields`): author fields are untouched, AI fields may be refreshed, empty-value proposals are ignored, and read-back never overwrites a protected plan field.

An explicit pick of an AI option (a selection rewrite) counts as the author's approval and may overwrite what the author wrote. Plan flesh-out only adds children, so it never touches the text of the chapter or scene being planned. Change records with `authorEdited` are never modified by read-back, including when they are matched or moved from the parent scene.

## Concurrent field saves

Plan item and entry saves from the in-place editors go through per-record queues (`revision-slots.ts`). Each save waits for the previous save on the same record and uses the newest revision returned. Without this, two quick edits to different fields of one record would both send the same `expectedRevision`, and the second would fail as a conflict the author did not cause.

A field the author has edited ignores store updates until its save lands (`useAutosaveFields`), so a plan-beats result or an accepted suggestion that updates the store mid-typing cannot overwrite it. The outline follows the reading position and outside selections only while the author is not working in it: focus is outside it and its portaled menus and dialogs, and no outline editor holds unsaved text. Following would otherwise collapse the card being edited, and a save that failed after the card unmounted would lose the text.

## Dynamic entry fields

Entry fields are an ordered list inside the existing JSON column. Data written before that is a record keyed by field name, and a read-time normalizer converts it without a migration.

- Converted fields get deterministic ids derived from the legacy key. Random ids per read would make every legacy field look new, so the first author edit would stamp all of them (including AI text) as author-owned. Author stamping compares the client list with the normalized stored list by id and content.
- Legacy empty values are dropped only during conversion (the old UI hid them). New-shape lists keep empty fields because the author added them deliberately.
- AI merges by normalized label and never overwrites author fields.
- The automatic details refresh (`refreshAiFields`) may add, update, and remove, but only `author: "ai"` fields, addressed by id. The staged result carries the entry revision the model read; the apply compares against it and silently writes nothing if the entry's revision moved since. Only a paragraph save schedules a refresh, so if a name or field edit made the result stale, nothing retries until the paragraph next changes. Duplicate details (author "Age: 19", AI "Age: 19") are why ownership, not label, decides what the refresh may touch.
- The 20,000-character value bound is not arbitrary: legacy values could be that long, and a tighter bound would leave them uneditable.
- Nothing may grow an entry past 40 fields: bundle ops, AI merges (`mergeAiFields` stops appending and reports what it skipped), and author edits. The edit check compares against the stored count instead of a flat schema bound, so an entry already over the cap stays editable and can shrink. With a flat bound, an entry an earlier AI merge had pushed over the cap could not be edited at all.

## Tension is unused, not dropped

Tension is no longer read, written, or shown, but `studio_plan_items.tension` and its CHECK remain. Dropping them makes drizzle-kit rebuild the table, and a rebuild's `DROP TABLE` cascade-deletes prose, versions, changes, flags, and child items inside the migrator's transaction (`PRAGMA foreign_keys=OFF` is a no-op there). Old bundle ops may still carry `tension`; apply and undo ignore it. New inserts write null.

## Aspect modes

Replay identity is entry + normalized label + about-entry. Two traps:

- AI paths (planning apply, read-back, bundle builder) coerce `mode` to the label's existing mode. One inconsistent model output would otherwise turn an accumulated list into a single replaced value. Accept coerces too, so even an accepted `change.update` cannot switch a label's mode: mode is a property of the aspect, not of one record. Only the author's change form may switch it.
- Stored data predating modes needs defaults in two places: the migration back-fills rows and stored flag payloads (`knows`/`note` become `add`), and the read-time flag parse applies the same default so an old flag cannot break workspace load. Legacy keys such as `where` and `feels` map to suggestion labels so they are not offered as new aspects.

Migration gotcha: drizzle-kit's table rebuild for `0011` was wrong in two ways and the SQL was hand-fixed. It selected a column that does not exist in the old table, and it table-qualified CHECK expressions with the temporary `__new_` name, which SQLite rejects after the rename. For future rebuild migrations, apply all migrations to a scratch in-memory SQLite and check the result. Prefer designs that avoid rebuilds (plain `ADD COLUMN`, no CHECK on values likely to grow).

## Review bundles (AI suggestions)

A bundle is one turn's proposed changes. They show in place (in the outline, characters, and manuscript) and the author accepts or dismisses them op by op, while the bundle stays pending.

- Accept is a single transaction with every pre-check run first, so a conflict never leaves half a bundle applied.
- Dependencies: accepting an op also accepts the pending creates it references (closure); dismissing a create dismisses its pending dependents. Ops that reference a dismissed create report `dependency-dismissed`.
- Rebase: accepting some ops changes the rows the others were proposed against (revisions, parent, position, change baselines), which would make every later op look stale. So after each accept, ops that were conflict-free before it get their baselines rewritten from the post-write rows. Ops that were already in conflict are never rebased, or an accept could launder a real conflict. Read-back (accepting prose forces one) rebases only the ops it made stale, for the same reason; undo rebases too.
- Descendant change-baseline rule: a change op still matches its baseline if its change was re-pinned to a descendant of the baseline's plan item with every other field equal. Read-back and flesh-out move planned changes down the tree, and that must not read as a conflict.
- Accepting a delete (plan or entry) dismisses pending ops that target inside the deleted subtree or entry, since they could never apply.
- Tracking ops ride along: a change op tied to a plan or prose op by target is accepted in a second phase after the visible op, and dismissed with it. It runs before the read-back so the read-back sees the records. Moves and deletes carry no tracking, and a tied op whose accept would pull in an unreviewed entry create stays in the conversation list for review.
- Baselines: each op records what it was proposed against. Plan revisions do not move for prose saves, child adds, or moves, so deletes also compare `updatedAt` of everything in the subtree against the proposal time. Plan moves carry parent and position baselines for the same reason. The window between a tool call and the save is accepted.
- A read action (`checkStudioBundleSelection`) reports every conflict by op id so the UI can mark ops to deselect. Accept errors alone are not enough for that.
- Undo is ownership-based for AI scaffolding, not value-based. Accepting prose forces a read-back, which legitimately rewrites AI-owned plan text, so a value check would make the main chat flow un-undoable. The cost is that undo can discard a read-back refresh of AI text; the next read-back regenerates it.
- Undo data (including whole-subtree delete snapshots) lives in the persisted op result, so it survives restarts.
- Decisions are idempotent: repeating one returns `replayed`.
- Op labels may name entries, plan items, and aspects but never field values, summaries, or prose, since they appear in toasts and conflict lists. Never log them.
- Op ids are unique only within a bundle (each turn numbers from `op-1`), so anything that points at an op (show-where from the conversation, or an in-place suggestion) must carry the bundle id too.
- There is no field-reorder op, a deliberate deviation from the spec's op list: new fields append and the author reorders them.

## Voice

Voice lives on the story (`genre`, `voice`, `voice_samples`, `instructions`); the design reasoning is below. Migrations 0017 (columns) and 0018 (carry-over) hold the data side.

- `studio_stories.style` is a dead column: nothing reads or writes it, but `studio_stories` must only ever gain `ADD COLUMN`. Dropping it makes drizzle-kit rebuild the table, and the rebuild's `DROP TABLE` cascade-deletes every story's plan, prose, and entries (same trap as tension above). Migration 0018 carried old style boxes over as AI notes and pasted samples as kept samples, so nothing was lost.
- Kept samples are the anchors of the voice: prompts carry them because exemplars steer prose better than descriptions of it. Picks and notes describe; samples show.
- A sample goes stale only when genre or an effective pick changes. Notes and *In your words* deliberately do not trigger it: they are small, frequent edits, and marking every sample stale on each one would make the anchors disappear from prompts almost constantly. The cost is that a note can drift from a sample until the next pick change or an explicit "Still sounds right".
- *In your words* holds author text only. Planning used to fill it, which made the author's own words indistinguishable from AI output and let a re-plan overwrite them, so planning stopped; AI-originated guidance goes in notes with `origin: "ai"`.
- The under-18 rule is fixed text in every prose prompt, not a setting. A toggle could be switched off by a note, a pick, or a sample that happens to pull that way.
- Right after onboarding the plan usually has only chapters, so samples are set at a beat when one fits and otherwise at a scene or chapter.
- Tuning from a passage always rewrites that passage, even when the complaint produces zero voice changes, so the author never gets a silent no-op. The rewrite is not added as a sample.
- AI box voice suggestions are `story.update` ops with whole-value `voice` and `genre` patches. They show in place on the Voice tab as one group per op, and an op that also patches other settings keeps its row in the conversation list.

## Agent chat

Flow: a prepare action stores the user message, a streaming route generates, the staged result is saved by a save action. The route body and the save action take ids only, for the same reason as the AI boundary above: browser text is never accepted as AI output.

- One bundle per turn. If the model never calls `finalize_bundle` (step cap, forgetfulness), the route stages the accumulated ops with a fallback summary rather than silently losing proposed work. A non-`stop` finish stages nothing.
- Aborted or failed turns persist nothing: discard deletes the prepared user message and the client puts the text back in the composer. The one deliberate exception: preparing a new message dismisses every pending op story-wide in the same transaction, and that dismissal is not undone if the turn is later discarded. The author moved on, and silently restoring old suggestions under a changed story would be worse than losing them. The model is told the dismissed labels only on the turn that dismissed them.
- Prose overlay: later moments in a turn are drafted against earlier proposed prose, not stale saved prose. A turn proposes prose for one scene only. The scene is claimed synchronously, because AI SDK 6 runs tool `execute` calls concurrently and an async claim would race.
- Write tool results carry metadata only (ids, word counts), never prose, to keep prose out of stored chat history. Within the turn the model can read its proposed prose back with `get_prose`.
- Tool input schemas are strict-safe for the same `strictJsonSchema` reason as structured output. The builder re-validates at propose time what accept enforces and returns `{ error }` so the model retries; accept stays the authority.
- Tools are not sent with `strict`, so a provider may omit required-nullable keys. A repair hook (`chat-tool-repair.ts`) fills omitted keys whose schema allows null and lets the SDK re-parse; the wire schemas stay strict-safe. The route end log reports `repairedToolCalls` next to `invalidToolCalls`.
- Output is capped per step (16k tokens) and tool inputs count toward it, so the prompt tells the model to split very large proposals across several propose calls. A truncated step ends as `length`, which discards the whole turn.
- Budgeting trims whole oldest turns and fails loudly if the current message still does not fit. It never truncates the current message.
- Deleting a thread rejects its pending bundles in the same transaction, because a pending bundle without its card leaves previews with no way to review.
- Chat session state lives outside the workspace store. Every store change re-renders the outline, Lexical editors, and entry cards, so per-token updates there would be costly.
