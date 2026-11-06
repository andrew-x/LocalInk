import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioPlanItems,
  studioStories,
} from "@/lib/drizzle/schema";
import { aspectIdentityKey, cleanAspectLabel } from "@/lib/studio/aspects";
import { STUDIO_CRAFT_FIELDS } from "@/lib/studio/bible-templates";
import type {
  StudioAspect,
  StudioChangeMode,
  StudioPlanKind,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import { mergeAiFields, normalizeEntryFields } from "@/lib/studio/entry-fields";
import {
  STUDIO_PLAN_STORY_TARGET,
  type StagedStudioPlan,
  type StudioInitialPlan,
} from "@/lib/studio/planning-contract";
import { cleanGenre, markStaleSamples } from "@/lib/studio/voice";
import { generateId } from "@/lib/util";

import {
  type AspectModeResolver,
  createAspectModeResolver,
} from "./aspect-modes";
import { listReplaceableBeats } from "./replan";
import {
  applySiblingOrder,
  listSiblingRows,
  loadStudioWorkspace,
  requireStudioStory,
  touchStudioStory,
} from "./repository";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "./staging";

// Matches the limits the author-facing action schemas enforce.
const MAX_TITLE = 200;
const MAX_TEXT = 20_000;
const MAX_CHANGE_VALUE = 4_000;
const MAX_NAME = 200;
const MAX_FIELD_VALUE = 4_000;
const MAX_CRAFT_VALUE = 2_000;

function clip(text: string, max: number): string {
  return text.trim().slice(0, max);
}

function nextPosition(
  tx: LocalinkTx,
  storyId: string,
  parentId: string | null,
): number {
  const rows = tx
    .select({
      parentId: studioPlanItems.parentId,
      position: studioPlanItems.position,
    })
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .all()
    .filter((row) => row.parentId === parentId);
  return rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
}

function pickCraft(
  kind: StudioPlanKind,
  craft: Record<string, string>,
): Record<string, string> {
  const allowed = new Set(STUDIO_CRAFT_FIELDS[kind].map((field) => field.key));
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(craft)) {
    const text = clip(value, MAX_CRAFT_VALUE);
    if (allowed.has(key) && text) result[key] = text;
  }
  return result;
}

type PlannedChangeInput = {
  entryId: string;
  aspect: StudioAspect;
  mode: StudioChangeMode;
  aboutEntryId?: string | null;
  value: string;
};

type NewPlanItem = {
  storyId: string;
  parentId: string | null;
  kind: StudioPlanKind;
  position: number;
  title: string;
  whatHappens: string;
  howToWrite: string;
  craft: Record<string, string>;
  presentEntryIds: string[];
  plannedChanges: PlannedChangeInput[];
};

/**
 * AI scaffolding: origin "ai", no author-protected fields. Entry ids that no
 * longer exist are dropped rather than failing the whole plan. Returns the
 * new id and the next free change position on it.
 */
function insertAiPlanItem(
  tx: LocalinkTx,
  validEntryIds: Set<string>,
  item: NewPlanItem,
  now: string,
  modes: AspectModeResolver,
): { id: string; nextChangePosition: number } {
  const id = generateId("studio-plan");
  tx.insert(studioPlanItems)
    .values({
      id,
      storyId: item.storyId,
      parentId: item.parentId,
      kind: item.kind,
      position: item.position,
      title: clip(item.title, MAX_TITLE),
      whatHappens: clip(item.whatHappens, MAX_TEXT),
      howToWrite: clip(item.howToWrite, MAX_TEXT),
      craft: pickCraft(item.kind, item.craft),
      presentEntryIds: [
        ...new Set(item.presentEntryIds.filter((id) => validEntryIds.has(id))),
      ],
      authorFields: [],
      origin: "ai",
      tension: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  let position = 0;
  for (const change of item.plannedChanges) {
    const value = clip(change.value, MAX_CHANGE_VALUE);
    const aspect = cleanAspectLabel(change.aspect);
    if (!value || !aspect || !validEntryIds.has(change.entryId)) continue;
    tx.insert(studioChanges)
      .values({
        id: generateId("studio-change"),
        storyId: item.storyId,
        entryId: change.entryId,
        aboutEntryId:
          change.aboutEntryId && validEntryIds.has(change.aboutEntryId)
            ? change.aboutEntryId
            : null,
        aspect,
        mode: modes.resolve(change.entryId, aspect, change.mode),
        value,
        planItemId: id,
        position: position++,
        source: "planned",
        status: "planned",
        authorEdited: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  return { id, nextChangePosition: position };
}

const changeKey = (change: {
  entryId: string;
  aspect: string;
  mode: StudioChangeMode;
  aboutEntryId?: string | null;
  value: string;
}) =>
  aspectIdentityKey({
    ...change,
    aboutEntryId: change.aboutEntryId ?? null,
  });

function loadEntryRows(tx: LocalinkTx, storyId: string) {
  return tx
    .select()
    .from(studioEntries)
    .where(eq(studioEntries.storyId, storyId))
    .all();
}

function applyInitial(
  tx: LocalinkTx,
  storyId: string,
  plan: StudioInitialPlan,
  now: string,
): void {
  const story = requireStudioStory(tx, storyId);

  // Only fill what is still empty; the author's values are never replaced.
  const genre = story.genre.length > 0 ? story.genre : cleanGenre(plan.genre);
  const voiceSamples = markStaleSamples(
    { genre: story.genre, voice: story.voice },
    { genre, voice: story.voice, samples: story.voiceSamples },
  );
  tx.update(studioStories)
    .set({
      overview: story.overview.trim()
        ? story.overview
        : clip(plan.overview, MAX_TEXT),
      theme: story.theme.trim() ? story.theme : clip(plan.theme, 2_000),
      genre,
      voiceSamples,
      // "freeform" is the default, so it is the only value safe to replace.
      structureTemplate:
        story.structureTemplate === "freeform"
          ? plan.structureTemplate
          : story.structureTemplate,
      setupStatus: "planned",
      updatedAt: now,
    })
    .where(eq(studioStories.id, storyId))
    .run();

  // Planning keeps the cast, which makes its AI-drafted paragraphs the
  // author's: from here on no AI path rewrites them.
  tx.update(studioEntries)
    .set({ summaryOrigin: "author" })
    .where(
      and(
        eq(studioEntries.storyId, storyId),
        eq(studioEntries.summaryOrigin, "ai"),
      ),
    )
    .run();

  // Bible entries. A name that already exists keeps the existing entry: its
  // untouched AI fields are refreshed and new labels are added (up to the
  // field cap) by `mergeAiFields`; author-written fields are never changed.
  const existing = loadEntryRows(tx, storyId);
  const positions = new Map<string, number>();
  for (const row of existing) {
    positions.set(
      row.type,
      Math.max(positions.get(row.type) ?? -1, row.position),
    );
  }
  const byName = new Map(
    existing.map((row) => [
      `${row.type}:${row.name.trim().toLowerCase()}`,
      row,
    ]),
  );
  // The plan refers to existing entries by their own id.
  const tempToId = new Map<string, string>(
    existing.map((row) => [row.id, row.id]),
  );
  const insertedRelated: { id: string; relatedTempIds: string[] }[] = [];
  // The cast step already set the characters (or places): the plan may not
  // add any of that type, and the author's tuned AI details are not
  // refreshed by a plan pass.
  const setTypes = new Set<string>(
    existing
      .map((row) => row.type)
      .filter((type) => type === "character" || type === "place"),
  );

  for (const entry of plan.entries) {
    const name = clip(entry.name, MAX_NAME);
    if (!name || tempToId.has(entry.tempId)) continue;
    const proposed = entry.fields.map((field) => ({
      ...field,
      value: clip(field.value, MAX_FIELD_VALUE),
    }));

    const match = byName.get(`${entry.type}:${name.toLowerCase()}`);
    if (setTypes.has(entry.type)) {
      if (match) tempToId.set(entry.tempId, match.id);
      continue;
    }
    if (match) {
      tempToId.set(entry.tempId, match.id);
      const current = normalizeEntryFields(match.fields, match.type);
      // Author-written fields are never touched; AI fields may be refreshed.
      const { fields: merged } = mergeAiFields(current, proposed);
      const summary = match.summary.trim()
        ? match.summary
        : clip(entry.summary, MAX_TEXT);
      if (
        JSON.stringify(merged) !== JSON.stringify(current) ||
        summary !== match.summary
      ) {
        tx.update(studioEntries)
          .set({
            fields: merged,
            summary,
            revision: match.revision + 1,
            updatedAt: now,
          })
          .where(eq(studioEntries.id, match.id))
          .run();
      }
      continue;
    }

    const id = generateId("studio-entry");
    const position = (positions.get(entry.type) ?? -1) + 1;
    positions.set(entry.type, position);
    tx.insert(studioEntries)
      .values({
        id,
        storyId,
        type: entry.type,
        customTypeLabel: entry.customTypeLabel,
        name,
        summary: clip(entry.summary, MAX_TEXT),
        fields: mergeAiFields([], proposed).fields,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tempToId.set(entry.tempId, id);
    insertedRelated.push({ id, relatedTempIds: entry.relatedTempIds });
  }

  for (const { id, relatedTempIds } of insertedRelated) {
    const related = [
      ...new Set(
        relatedTempIds
          .map((tempId) => tempToId.get(tempId))
          .filter(
            (value): value is string => value !== undefined && value !== id,
          ),
      ),
    ];
    if (related.length === 0) continue;
    tx.update(studioEntries)
      .set({ relatedEntryIds: related })
      .where(eq(studioEntries.id, id))
      .run();
  }

  const modes = createAspectModeResolver(tx, storyId);
  const validEntryIds = new Set(tempToId.values());
  for (const row of existing) validEntryIds.add(row.id);
  const resolve = (tempId: string | null | undefined) =>
    tempId ? (tempToId.get(tempId) ?? null) : null;
  const resolveAll = (tempIds: string[]) =>
    tempIds
      .map((tempId) => tempToId.get(tempId))
      .filter((value): value is string => value !== undefined);
  const resolveChanges = (
    changes: StudioInitialPlan["chapters"][number]["plannedChanges"],
  ): PlannedChangeInput[] =>
    changes.flatMap((change) => {
      const entryId = resolve(change.entryTempId);
      return entryId
        ? [
            {
              entryId,
              aspect: change.aspect,
              mode: change.mode,
              aboutEntryId: resolve(change.aboutTempId),
              value: change.value,
            },
          ]
        : [];
    });

  const chapterBase = nextPosition(tx, storyId, null);
  plan.chapters.forEach((chapter, chapterIndex) => {
    const { id: chapterId } = insertAiPlanItem(
      tx,
      validEntryIds,
      {
        storyId,
        parentId: null,
        kind: "chapter",
        position: chapterBase + chapterIndex,
        title: chapter.title,
        whatHappens: chapter.whatHappens,
        howToWrite: chapter.howToWrite,
        craft: chapter.craft,
        presentEntryIds: resolveAll(chapter.presentTempIds),
        plannedChanges: resolveChanges(chapter.plannedChanges),
      },
      now,
      modes,
    );
    (chapter.scenes ?? []).forEach((scene, sceneIndex) => {
      insertAiPlanItem(
        tx,
        validEntryIds,
        {
          storyId,
          parentId: chapterId,
          kind: "scene",
          position: sceneIndex,
          title: scene.title,
          whatHappens: scene.whatHappens,
          howToWrite: scene.howToWrite,
          craft: scene.craft,
          presentEntryIds: resolveAll(scene.presentTempIds),
          plannedChanges: resolveChanges(scene.plannedChanges),
        },
        now,
        modes,
      );
    });
  });
}

function applyFleshOut(
  tx: LocalinkTx,
  storyId: string,
  staged: Extract<StagedStudioPlan, { mode: "flesh-out" }>,
  now: string,
): void {
  const modes = createAspectModeResolver(tx, storyId);
  const validEntryIds = new Set(
    loadEntryRows(tx, storyId).map((row) => row.id),
  );
  const isStoryWide = staged.targetItemId === STUDIO_PLAN_STORY_TARGET;

  for (const group of staged.groups) {
    const parent = tx
      .select()
      .from(studioPlanItems)
      .where(
        and(
          eq(studioPlanItems.id, group.parentId),
          eq(studioPlanItems.storyId, storyId),
        ),
      )
      .get();
    if (!parent) {
      if (isStoryWide) continue;
      throw new ActionError("BAD_REQUEST", "The plan item could not be found.");
    }
    const childKind: StudioPlanKind | null =
      parent.kind === "chapter"
        ? "scene"
        : parent.kind === "scene"
          ? "moment"
          : null;
    if (!childKind) {
      throw new ActionError(
        "BAD_REQUEST",
        "Moments cannot be broken down further.",
      );
    }
    // A story-wide run only fills chapters that are still empty.
    if (isStoryWide && nextPosition(tx, storyId, parent.id) > 0) continue;
    insertAiChildren(tx, storyId, parent.id, childKind, group.items, {
      modes,
      validEntryIds,
      now,
    });
  }
}

type StagedChildItems = Extract<
  StagedStudioPlan,
  { mode: "flesh-out" }
>["groups"][number]["items"];

/** Appends AI children to a parent, moving down the changes they carry. */
function insertAiChildren(
  tx: LocalinkTx,
  storyId: string,
  parentId: string,
  childKind: StudioPlanKind,
  items: StagedChildItems,
  context: {
    modes: AspectModeResolver;
    validEntryIds: Set<string>;
    now: string;
  },
): void {
  const { modes, validEntryIds, now } = context;
  const base = nextPosition(tx, storyId, parentId);

  // The parent's planned changes a child realizes move down to that child
  // (first claimant wins), so the arc stays visible below the parent.
  const parentChanges = new Map(
    tx
      .select()
      .from(studioChanges)
      .where(
        and(
          eq(studioChanges.storyId, storyId),
          eq(studioChanges.planItemId, parentId),
        ),
      )
      .all()
      .map((row) => [row.id, row]),
  );
  const claimed = new Set<string>();
  items.forEach((item, index) => {
    const carried = item.carriesChangeIds.flatMap((changeId) => {
      const row = parentChanges.get(changeId);
      if (!row || claimed.has(changeId)) return [];
      claimed.add(changeId);
      return [row];
    });
    // A carried change is never inserted again as a new planned change.
    const carriedKeys = new Set(carried.map(changeKey));
    const { id, nextChangePosition } = insertAiPlanItem(
      tx,
      validEntryIds,
      {
        storyId,
        parentId,
        kind: childKind,
        position: base + index,
        title: item.title,
        whatHappens: item.whatHappens,
        howToWrite: item.howToWrite,
        craft: item.craft,
        presentEntryIds: item.presentEntryIds,
        plannedChanges: item.plannedChanges
          .map((change) => ({
            ...change,
            mode: modes.resolve(change.entryId, change.aspect, change.mode),
          }))
          .filter((change) => !carriedKeys.has(changeKey(change))),
      },
      now,
      modes,
    );
    let position = nextChangePosition;
    for (const row of carried) {
      if (row.authorEdited || row.status !== "planned") continue;
      tx.update(studioChanges)
        .set({ planItemId: id, position: position++, updatedAt: now })
        .where(eq(studioChanges.id, row.id))
        .run();
    }
  });
}

/**
 * Replaces a scene's replaceable beats with the staged ones. The scene's
 * description and every replaceable beat must be as they were when the plan
 * was generated; anything else changed means the plan is stale.
 */
function applyReplan(
  tx: LocalinkTx,
  storyId: string,
  staged: Extract<StagedStudioPlan, { mode: "replan" }>,
  now: string,
): void {
  const scene = tx
    .select()
    .from(studioPlanItems)
    .where(
      and(
        eq(studioPlanItems.id, staged.targetItemId),
        eq(studioPlanItems.storyId, storyId),
      ),
    )
    .get();
  if (scene?.kind !== "scene") {
    throw new ActionError("BAD_REQUEST", "The scene could not be found.");
  }
  const current = listReplaceableBeats(tx, storyId, scene.id);
  const plannedFrom = new Map(
    staged.replaced.map((beat) => [beat.id, beat.revision]),
  );
  if (
    scene.whatHappens !== staged.sceneWhatHappens ||
    current.length !== staged.replaced.length ||
    current.some((beat) => plannedFrom.get(beat.id) !== beat.revision)
  ) {
    throw new ActionError(
      "CONFLICT",
      "This scene changed while its beats were being planned. Replan its beats again.",
    );
  }

  const replacedIds = staged.replaced.map((beat) => beat.id);
  if (replacedIds.length > 0) {
    // Changes on the replaced beats go back to the scene, where the new beats
    // can carry them again, instead of being deleted with the beats.
    const sceneChanges = tx
      .select({ position: studioChanges.position })
      .from(studioChanges)
      .where(
        and(
          eq(studioChanges.storyId, storyId),
          eq(studioChanges.planItemId, scene.id),
        ),
      )
      .all();
    let position =
      sceneChanges.reduce((max, row) => Math.max(max, row.position), -1) + 1;
    const beatOrder = new Map(replacedIds.map((id, index) => [id, index]));
    const moved = tx
      .select()
      .from(studioChanges)
      .where(
        and(
          eq(studioChanges.storyId, storyId),
          inArray(studioChanges.planItemId, replacedIds),
        ),
      )
      .all()
      .sort(
        (a, b) =>
          (beatOrder.get(a.planItemId) ?? 0) -
            (beatOrder.get(b.planItemId) ?? 0) || a.position - b.position,
      );
    for (const row of moved) {
      tx.update(studioChanges)
        .set({ planItemId: scene.id, position: position++, updatedAt: now })
        .where(eq(studioChanges.id, row.id))
        .run();
    }
    tx.delete(studioPlanItems)
      .where(
        and(
          eq(studioPlanItems.storyId, storyId),
          inArray(studioPlanItems.id, replacedIds),
        ),
      )
      .run();
    const remaining = listSiblingRows(tx, storyId, scene.id).map(
      (row) => row.id,
    );
    applySiblingOrder(tx, storyId, scene.id, remaining, now);
  }

  insertAiChildren(tx, storyId, scene.id, "moment", staged.items, {
    modes: createAspectModeResolver(tx, storyId),
    validEntryIds: new Set(loadEntryRows(tx, storyId).map((row) => row.id)),
    now,
  });
}

export function applyStagedStudioPlan(
  tx: LocalinkTx,
  input: { storyId: string; staged: StagedStudioPlan },
): void {
  const { storyId, staged } = input;
  const now = day().toISOString();
  requireStudioStory(tx, storyId);

  switch (staged.mode) {
    case "initial":
      applyInitial(tx, storyId, staged.plan, now);
      break;
    case "flesh-out":
      applyFleshOut(tx, storyId, staged, now);
      break;
    case "replan":
      applyReplan(tx, storyId, staged, now);
      break;
  }
  touchStudioStory(tx, storyId, now);
}

export function commitStudioPlan(input: {
  storyId: string;
  generationId: string;
  mode: StagedStudioPlan["mode"];
  targetItemId?: string;
}): StudioWorkspace {
  if (input.mode !== "initial" && !input.targetItemId) {
    throw new ActionError("BAD_REQUEST", "This plan needs a target.");
  }
  const binding: StudioStageBinding = {
    storyId: input.storyId,
    kind: "plan",
    targetId: input.targetItemId ?? STUDIO_PLAN_STORY_TARGET,
    generationId: input.generationId,
  };
  const staged = getStudioStage<StagedStudioPlan>(binding);
  if (staged.mode !== input.mode) {
    throw new ActionError(
      "BAD_REQUEST",
      "This generated result does not match the request. Please generate it again.",
    );
  }

  getDb().transaction((tx) =>
    applyStagedStudioPlan(tx, { storyId: input.storyId, staged }),
  );
  // Dropped only after a successful commit so a failed apply can be retried.
  dropStudioStage(binding);

  const workspace = loadStudioWorkspace(input.storyId);
  if (!workspace) {
    throw new ActionError("BAD_REQUEST", "The story could not be found.");
  }
  return workspace;
}
