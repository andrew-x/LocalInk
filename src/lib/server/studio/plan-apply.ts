import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkTx } from "@/lib/drizzle/db";
import {
  studioChanges,
  studioEntries,
  studioPlanItems,
  studioStories,
} from "@/lib/drizzle/schema";
import {
  STUDIO_CRAFT_FIELDS,
  STUDIO_ENTRY_TEMPLATES,
} from "@/lib/studio/bible-templates";
import type {
  StudioAspect,
  StudioFieldValue,
  StudioPlanField,
  StudioPlanKind,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import {
  STUDIO_PLAN_STORY_TARGET,
  type StagedStudioPlan,
  type StudioInitialPlan,
} from "@/lib/studio/planning-contract";
import { generateId } from "@/lib/util";

import {
  loadStudioWorkspace,
  requirePlanItem,
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
  tension: number | null;
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
      tension:
        item.kind === "chapter" && item.tension !== null
          ? Math.min(10, Math.max(1, Math.round(item.tension)))
          : null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  let position = 0;
  for (const change of item.plannedChanges) {
    const value = clip(change.value, MAX_CHANGE_VALUE);
    if (!value || !validEntryIds.has(change.entryId)) continue;
    tx.insert(studioChanges)
      .values({
        id: generateId("studio-change"),
        storyId: item.storyId,
        entryId: change.entryId,
        aboutEntryId:
          change.aboutEntryId && validEntryIds.has(change.aboutEntryId)
            ? change.aboutEntryId
            : null,
        aspect: change.aspect,
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
  aboutEntryId?: string | null;
}) =>
  JSON.stringify([change.entryId, change.aspect, change.aboutEntryId ?? null]);

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
  const style = { ...story.style };
  for (const key of Object.keys(style) as (keyof typeof style)[]) {
    if (!style[key].trim()) style[key] = clip(plan.style[key], MAX_TEXT);
  }
  tx.update(studioStories)
    .set({
      overview: story.overview.trim()
        ? story.overview
        : clip(plan.overview, MAX_TEXT),
      instructions: story.instructions.trim()
        ? story.instructions
        : clip(plan.instructions, 8_000),
      theme: story.theme.trim() ? story.theme : clip(plan.theme, 2_000),
      style,
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

  // Bible entries. A name that already exists keeps the existing entry; only
  // its missing fields are filled.
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
  const tempToId = new Map<string, string>();
  const insertedRelated: { id: string; relatedTempIds: string[] }[] = [];

  for (const entry of plan.entries) {
    const name = clip(entry.name, MAX_NAME);
    if (!name || tempToId.has(entry.tempId)) continue;
    const allowedKeys = new Set(
      STUDIO_ENTRY_TEMPLATES[entry.type].fields.map((field) => field.key),
    );
    const aiFields: Record<string, StudioFieldValue> = {};
    for (const [key, value] of Object.entries(entry.fields)) {
      const text = clip(value, MAX_TEXT);
      if (allowedKeys.has(key) && text)
        aiFields[key] = { value: text, author: "ai" };
    }

    const match = byName.get(`${entry.type}:${name.toLowerCase()}`);
    if (match) {
      tempToId.set(entry.tempId, match.id);
      const missing = Object.fromEntries(
        Object.entries(aiFields).filter(
          ([key]) => !(key in match.fields) || !match.fields[key].value.trim(),
        ),
      );
      const summary = match.summary.trim()
        ? match.summary
        : clip(entry.summary, MAX_TEXT);
      if (Object.keys(missing).length > 0 || summary !== match.summary) {
        tx.update(studioEntries)
          .set({
            fields: { ...match.fields, ...missing },
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
        name,
        summary: clip(entry.summary, MAX_TEXT),
        fields: aiFields,
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
        tension: chapter.tension,
        plannedChanges: resolveChanges(chapter.plannedChanges),
      },
      now,
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
          tension: null,
          plannedChanges: resolveChanges(scene.plannedChanges),
        },
        now,
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
    const base = nextPosition(tx, storyId, parent.id);
    // A story-wide run only fills chapters that are still empty.
    if (isStoryWide && base > 0) continue;

    // The parent's planned changes a child realizes move down to that child
    // (first claimant wins), so the arc stays visible below the parent.
    const parentChanges = new Map(
      tx
        .select()
        .from(studioChanges)
        .where(
          and(
            eq(studioChanges.storyId, storyId),
            eq(studioChanges.planItemId, parent.id),
          ),
        )
        .all()
        .map((row) => [row.id, row]),
    );
    const claimed = new Set<string>();
    group.items.forEach((item, index) => {
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
          parentId: parent.id,
          kind: childKind,
          position: base + index,
          title: item.title,
          whatHappens: item.whatHappens,
          howToWrite: item.howToWrite,
          craft: item.craft,
          presentEntryIds: item.presentEntryIds,
          tension: null,
          plannedChanges: item.plannedChanges.filter(
            (change) => !carriedKeys.has(changeKey(change)),
          ),
        },
        now,
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
}

/**
 * An explicit pick of an AI option counts as the author's approval, so it
 * may overwrite fields the author wrote and then protects all three.
 */
function applyPickedBrief(
  tx: LocalinkTx,
  storyId: string,
  targetItemId: string,
  brief: { title: string; whatHappens: string; howToWrite: string },
  now: string,
): void {
  const target = requirePlanItem(tx, storyId, targetItemId);
  const authorFields = [
    ...new Set<StudioPlanField>([
      ...target.authorFields,
      "title",
      "whatHappens",
      "howToWrite",
    ]),
  ];
  tx.update(studioPlanItems)
    .set({
      title: clip(brief.title, MAX_TITLE),
      whatHappens: clip(brief.whatHappens, MAX_TEXT),
      howToWrite: clip(brief.howToWrite, MAX_TEXT),
      authorFields,
      revision: target.revision + 1,
      updatedAt: now,
    })
    .where(eq(studioPlanItems.id, targetItemId))
    .run();
}

export function applyStagedStudioPlan(
  tx: LocalinkTx,
  input: { storyId: string; staged: StagedStudioPlan; optionIndex?: number },
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
    case "alternatives": {
      const option =
        input.optionIndex === undefined
          ? undefined
          : staged.options[input.optionIndex];
      if (!option) {
        throw new ActionError("BAD_REQUEST", "Choose one of the alternatives.");
      }
      applyPickedBrief(tx, storyId, staged.targetItemId, option, now);
      break;
    }
    case "rewrite-brief":
      applyPickedBrief(tx, storyId, staged.targetItemId, staged.brief, now);
      break;
  }
  touchStudioStory(tx, storyId, now);
}

export function commitStudioPlan(input: {
  storyId: string;
  generationId: string;
  mode: StagedStudioPlan["mode"];
  targetItemId?: string;
  optionIndex?: number;
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
    applyStagedStudioPlan(tx, {
      storyId: input.storyId,
      staged,
      optionIndex: input.optionIndex,
    }),
  );
  // Dropped only after a successful commit so a failed apply can be retried.
  dropStudioStage(binding);

  const workspace = loadStudioWorkspace(input.storyId);
  if (!workspace) {
    throw new ActionError("BAD_REQUEST", "The story could not be found.");
  }
  return workspace;
}
