import "server-only";

import { normalizeAspect, normalizeValue } from "@/lib/studio/aspects";
import { isStudioBundleTempRef } from "@/lib/studio/bundle-contract";
import type { StudioChangeMode } from "@/lib/studio/contracts";

import { type BuilderDraft, type OpOf, quoted } from "./bundle-draft";

/**
 * Change records for the chat's bundle candidate, with the same
 * conventions as bundle-builder-ops.ts. A change's mode follows the label's
 * existing mode (Ruling A12); the model is told when its mode was not kept.
 */

export type ChangeItemInput = {
  op: "create" | "update" | "delete";
  changeId: string | null;
  entryId: string | null;
  planItemId: string | null;
  aspect: string | null;
  mode: StudioChangeMode | null;
  value: string | null;
  /** On update, "none" clears it; null leaves it unchanged. */
  aboutEntryId: string | null;
};

const MAX_ASPECT_CHARS = 60;
const MAX_CHANGE_VALUE_CHARS = 4000;
const CLEAR_ABOUT = "none";

function cleanText(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * The mode a change must use (Ruling A12): a label the entry already tracks
 * keeps its saved mode; a label new in this bundle keeps the mode its first
 * use chose, as accept will.
 */
export function decideMode(
  draft: BuilderDraft,
  entryRef: string,
  aspect: string,
  proposed: StudioChangeMode,
): StudioChangeMode {
  const key = JSON.stringify([entryRef, normalizeAspect(aspect)]);
  const decided = draft.state.decidedModes.get(key);
  if (decided) return decided;
  const mode = isStudioBundleTempRef(entryRef)
    ? proposed
    : draft.snap.modes.resolve(entryRef, aspect, proposed);
  draft.state.decidedModes.set(key, mode);
  return mode;
}

function cleanAspect(
  draft: BuilderDraft,
  index: number,
  aspect: string | null,
): string | null {
  const label = cleanText(aspect);
  if (!label || label.length > MAX_ASPECT_CHARS) {
    draft.fail(index, `aspect must be 1 to ${MAX_ASPECT_CHARS} characters`);
    return null;
  }
  return label;
}

function cleanChangeValue(
  draft: BuilderDraft,
  index: number,
  value: string | null,
): string | null {
  const text = (value ?? "").trim();
  if (!text || text.length > MAX_CHANGE_VALUE_CHARS) {
    draft.fail(
      index,
      `value must be 1 to ${MAX_CHANGE_VALUE_CHARS.toLocaleString("en-US")} characters`,
    );
    return null;
  }
  return text;
}

function changeLabel(
  draft: BuilderDraft,
  verb: string,
  entryRef: string,
  aspect: string,
): string {
  return `${verb} ${quoted(draft.entryName(entryRef), "entry")}: ${aspect}`;
}

function createChange(
  draft: BuilderDraft,
  item: ChangeItemInput,
  index: number,
) {
  if (item.changeId !== null) {
    return draft.fail(
      index,
      "create takes entryId and planItemId, not changeId",
    );
  }
  const entry = draft.entry(item.entryId);
  if (!entry.ok) return draft.fail(index, entry.error);
  const plan = draft.planItem(item.planItemId);
  if (!plan.ok) return draft.fail(index, plan.error);
  const aspect = cleanAspect(draft, index, item.aspect);
  if (aspect === null) return;
  if (item.mode === null) return draft.fail(index, "create needs a mode");
  const value = cleanChangeValue(draft, index, item.value);
  if (value === null) return;
  let aboutRef: string | null = null;
  if (item.aboutEntryId !== null && item.aboutEntryId !== CLEAR_ABOUT) {
    const about = draft.entry(item.aboutEntryId);
    if (!about.ok) return draft.fail(index, about.error);
    aboutRef = about.value.ref;
  }
  const identity = (
    entryRef: string,
    label: string,
    about: string | null,
    text: string,
    planRef: string,
  ) =>
    JSON.stringify([
      entryRef,
      normalizeAspect(label),
      about,
      normalizeValue(text),
      planRef,
    ]);
  const key = identity(
    entry.value.ref,
    aspect,
    aboutRef,
    value,
    plan.value.ref,
  );
  const duplicate =
    [...draft.snap.rows.changes.values()].some(
      (change) =>
        identity(
          change.entryId,
          change.aspect,
          change.aboutEntryId,
          change.value,
          change.planItemId,
        ) === key,
    ) ||
    draft
      .filter("change.create")
      .some(
        (op) =>
          identity(
            op.entryRef,
            op.aspect,
            op.aboutEntryRef,
            op.value,
            op.planItemRef,
          ) === key,
      );
  if (duplicate) {
    return draft.fail(index, "this change is already recorded on that item");
  }
  const mode = decideMode(draft, entry.value.ref, aspect, item.mode);
  if (mode !== item.mode) {
    draft.notes.push(
      `${quoted(entry.value.name, "The entry")} already tracks “${aspect}” with mode ${mode}, so the new change uses ${mode}.`,
    );
  }
  draft.addOp<OpOf<"change.create">>({
    kind: "change.create",
    label: changeLabel(draft, "Change for", entry.value.ref, aspect),
    entryRef: entry.value.ref,
    aspect,
    mode,
    aboutEntryRef: aboutRef,
    value,
    planItemRef: plan.value.ref,
  });
}

function updateChange(
  draft: BuilderDraft,
  item: ChangeItemInput,
  index: number,
) {
  const id = item.changeId?.trim() ?? "";
  if (!id) return draft.fail(index, "update needs changeId");
  const row = draft.snap.rows.changes.get(id);
  if (!row) return draft.fail(index, `there is no change with id ${id}`);
  if (draft.find("change.delete", (op) => op.changeId === id)) {
    return draft.fail(
      index,
      `change ${id} is proposed for deletion in this turn`,
    );
  }
  if (item.entryId !== null && item.entryId.trim() !== row.entryId) {
    return draft.fail(
      index,
      "a change stays on its entry; delete it and create a new one instead",
    );
  }
  const op = draft.find(
    "change.update",
    (candidate) => candidate.changeId === id,
  );
  const baseline: OpOf<"change.update">["baseline"] = op?.baseline ?? {
    aspect: row.aspect,
    mode: row.mode,
    value: row.value,
    aboutEntryId: row.aboutEntryId,
    planItemId: row.planItemId,
  };
  const target = {
    aspect: op?.patch.aspect ?? baseline.aspect,
    mode: op?.patch.mode ?? baseline.mode,
    value: op?.patch.value ?? baseline.value,
    aboutEntryId:
      op?.patch.aboutEntryId !== undefined
        ? op.patch.aboutEntryId
        : baseline.aboutEntryId,
    planItemId: op?.patch.planItemId ?? baseline.planItemId,
  };
  if (item.aspect !== null) {
    const aspect = cleanAspect(draft, index, item.aspect);
    if (aspect === null) return;
    target.aspect = aspect;
  }
  if (item.value !== null) {
    const value = cleanChangeValue(draft, index, item.value);
    if (value === null) return;
    target.value = value;
  }
  if (item.aboutEntryId === CLEAR_ABOUT) {
    target.aboutEntryId = null;
  } else if (item.aboutEntryId !== null) {
    const about = draft.entry(item.aboutEntryId);
    if (!about.ok) return draft.fail(index, about.error);
    target.aboutEntryId = about.value.ref;
  }
  if (item.planItemId !== null) {
    const plan = draft.planItem(item.planItemId);
    if (!plan.ok) return draft.fail(index, plan.error);
    target.planItemId = plan.value.ref;
  }
  if (item.mode !== null) target.mode = item.mode;
  let modeNote: string | null = null;
  if (target.aspect !== baseline.aspect || target.mode !== baseline.mode) {
    const mode = decideMode(draft, row.entryId, target.aspect, target.mode);
    if (item.mode !== null && mode !== item.mode) {
      modeNote = `“${target.aspect}” keeps mode ${mode} on ${quoted(draft.entryName(row.entryId), "its entry")}; only the author can change a label's mode.`;
    }
    target.mode = mode;
  }

  const patch: OpOf<"change.update">["patch"] = {};
  if (target.aspect !== baseline.aspect) patch.aspect = target.aspect;
  if (target.mode !== baseline.mode) patch.mode = target.mode;
  if (target.value !== baseline.value) patch.value = target.value;
  if (target.aboutEntryId !== baseline.aboutEntryId) {
    patch.aboutEntryId = target.aboutEntryId;
  }
  if (target.planItemId !== baseline.planItemId) {
    patch.planItemId = target.planItemId;
  }
  const label = changeLabel(
    draft,
    "Edit change for",
    row.entryId,
    target.aspect,
  );
  if (Object.keys(patch).length === 0) {
    if (op) {
      draft.removeOp(
        op,
        `The edit of change ${id} now matches what is saved, so it was dropped.`,
      );
      return;
    }
    return draft.fail(index, modeNote ?? "this update changes nothing");
  }
  if (modeNote) draft.notes.push(modeNote);
  if (op) {
    op.patch = patch;
    op.label = label;
    draft.markChanged(op);
    return;
  }
  draft.addOp<OpOf<"change.update">>({
    kind: "change.update",
    label,
    changeId: id,
    baseline,
    patch,
  });
}

function deleteChange(
  draft: BuilderDraft,
  item: ChangeItemInput,
  index: number,
) {
  const id = item.changeId?.trim() ?? "";
  if (!id) return draft.fail(index, "delete needs changeId");
  const row = draft.snap.rows.changes.get(id);
  if (!row) return draft.fail(index, `there is no change with id ${id}`);
  if (draft.find("change.delete", (op) => op.changeId === id)) {
    return draft.fail(index, `change ${id} is already proposed for deletion`);
  }
  const update = draft.find("change.update", (op) => op.changeId === id);
  if (update) {
    draft.removeOp(
      update,
      `The earlier edit of change ${id} was dropped because it is now proposed for deletion.`,
    );
  }
  draft.addOp<OpOf<"change.delete">>({
    kind: "change.delete",
    label: changeLabel(draft, "Remove change for", row.entryId, row.aspect),
    changeId: id,
    baseline: {
      aspect: row.aspect,
      mode: row.mode,
      value: row.value,
      aboutEntryId: row.aboutEntryId,
      planItemId: row.planItemId,
    },
  });
}

export function proposeChanges(
  draft: BuilderDraft,
  items: ChangeItemInput[],
): void {
  if (items.length === 0) draft.errors.push("items is empty");
  items.forEach((item, index) => {
    if (item.op === "create") createChange(draft, item, index);
    else if (item.op === "update") updateChange(draft, item, index);
    else deleteChange(draft, item, index);
  });
}
