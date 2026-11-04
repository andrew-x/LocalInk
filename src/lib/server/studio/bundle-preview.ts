import "server-only";

import type { StudioBundleOpInput } from "@/lib/studio/bundle-contract";
import type {
  StudioChangeDto,
  StudioEntryDto,
  StudioPlanItemDto,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import { applyFieldOps } from "@/lib/studio/entry-fields";

import type { OpOf } from "./bundle-draft";

/**
 * The workspace as it would look with a bundle candidate applied, for the
 * prose the chat writes in the same turn: a new moment can be written, and
 * moments follow edited briefs, new entries, and proposed change records.
 * Temp refs stay as ids. Prose is not applied here; the prompt builder takes
 * proposed prose as an overlay. Nothing is validated: the builder already
 * checked the ops, and accept stays the authority.
 */
export function previewStudioWorkspace(
  workspace: StudioWorkspace,
  ops: StudioBundleOpInput[],
  now: string,
): StudioWorkspace {
  const of = <K extends StudioBundleOpInput["kind"]>(kind: K) =>
    ops.filter((op): op is OpOf<K> => op.kind === kind);
  const storyId = workspace.story.id;

  let story = workspace.story;
  for (const op of of("story.update")) story = { ...story, ...op.patch };

  const entries = new Map<string, StudioEntryDto>(
    workspace.entries.map((entry) => [entry.id, { ...entry }]),
  );
  for (const op of of("entry.create")) {
    entries.set(op.tempId, {
      id: op.tempId,
      storyId,
      type: op.entry.type,
      customTypeLabel: op.entry.customTypeLabel,
      name: op.entry.name,
      summary: op.entry.summary,
      fields: applyFieldOps(
        [],
        op.entry.fields.map((field) => ({ op: "set" as const, ...field })),
      ),
      relatedEntryIds: op.entry.relatedEntryRefs,
      position: entries.size,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const op of of("entry.update")) {
    const entry = entries.get(op.entryId);
    if (!entry) continue;
    entries.set(op.entryId, {
      ...entry,
      name: op.patch.name ?? entry.name,
      summary: op.patch.summary ?? entry.summary,
      fields: applyFieldOps(entry.fields, op.patch.fieldOps),
    });
  }

  const items = new Map<string, StudioPlanItemDto>(
    workspace.planItems.map((item) => [item.id, { ...item }]),
  );
  const siblings = (parentId: string | null) =>
    [...items.values()]
      .filter((item) => item.parentId === parentId)
      .sort(
        (a, b) =>
          a.position - b.position ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
  const renumber = (list: StudioPlanItemDto[]) => {
    list.forEach((item, position) => {
      item.position = position;
    });
  };
  // Parents and earlier siblings first, as accept orders them.
  const pending = [...of("plan.create")];
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    for (const op of [...pending]) {
      const waits = [op.item.parentRef, op.item.afterRef].some(
        (ref) => ref !== null && !items.has(ref),
      );
      if (waits) continue;
      const list = siblings(op.item.parentRef);
      const after =
        op.item.afterRef === null
          ? -1
          : list.findIndex((item) => item.id === op.item.afterRef);
      const item: StudioPlanItemDto = {
        id: op.tempId,
        storyId,
        parentId: op.item.parentRef,
        kind: op.item.kind,
        position: 0,
        title: op.item.title,
        whatHappens: op.item.whatHappens,
        howToWrite: op.item.howToWrite,
        craft: op.item.craft,
        presentEntryIds: op.item.presentEntryRefs,
        contextPinnedEntryIds: [],
        contextExcludedEntryIds: [],
        authorFields: [],
        origin: "ai",
        summary: "",
        revision: 0,
        createdAt: now,
        updatedAt: now,
      };
      list.splice(after === -1 ? list.length : after + 1, 0, item);
      items.set(item.id, item);
      renumber(list);
      pending.splice(pending.indexOf(op), 1);
      progressed = true;
    }
  }
  for (const op of of("plan.update")) {
    const item = items.get(op.itemId);
    if (item) items.set(op.itemId, Object.assign(item, op.patch));
  }
  for (const op of of("plan.move")) {
    const item = items.get(op.itemId);
    if (!item) continue;
    const oldParent = item.parentId;
    item.parentId = op.newParentRef;
    const list = siblings(op.newParentRef).filter((other) => other !== item);
    list.splice(Math.min(op.newIndex, list.length), 0, item);
    renumber(list);
    renumber(siblings(oldParent));
  }

  const changes = new Map<string, StudioChangeDto>(
    workspace.changes.map((change) => [change.id, { ...change }]),
  );
  of("change.create").forEach((op, index) => {
    changes.set(op.id, {
      id: op.id,
      storyId,
      entryId: op.entryRef,
      aboutEntryId: op.aboutEntryRef,
      aspect: op.aspect,
      mode: op.mode,
      value: op.value,
      planItemId: op.planItemRef,
      position: 1_000_000 + index,
      source: "planned",
      status: "planned",
      authorEdited: false,
      createdAt: now,
      updatedAt: now,
    });
  });
  for (const op of of("change.update")) {
    const change = changes.get(op.changeId);
    if (change) changes.set(op.changeId, { ...change, ...op.patch });
  }
  for (const op of of("change.delete")) changes.delete(op.changeId);

  // Deletes last: whole subtrees, then entries.
  const removedItems = new Set<string>();
  for (const op of of("plan.delete")) removedItems.add(op.itemId);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items.values()) {
      if (
        item.parentId &&
        removedItems.has(item.parentId) &&
        !removedItems.has(item.id)
      ) {
        removedItems.add(item.id);
        grew = true;
      }
    }
  }
  for (const id of removedItems) items.delete(id);
  const removedEntries = new Set(of("entry.delete").map((op) => op.entryId));
  for (const id of removedEntries) entries.delete(id);
  for (const [id, change] of changes) {
    if (
      removedItems.has(change.planItemId) ||
      removedEntries.has(change.entryId)
    ) {
      changes.delete(id);
    }
  }

  return {
    story,
    entries: [...entries.values()],
    planItems: [...items.values()],
    changes: [...changes.values()],
    prose: workspace.prose.filter((prose) => !removedItems.has(prose.momentId)),
    flags: workspace.flags.filter((flag) => !removedItems.has(flag.planItemId)),
    entrySuggestions: [],
    bundles: [],
  };
}
