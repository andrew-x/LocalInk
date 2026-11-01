import "server-only";

import { isDeepStrictEqual } from "node:util";

import {
  isStudioBundleTempRef,
  type StudioBundleStoryPatch,
  studioBundleOpRefs,
} from "@/lib/studio/bundle-contract";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioEntryField,
  type StudioEntryType,
  type StudioStructureTemplateId,
  type StudioStyle,
} from "@/lib/studio/contracts";
import {
  applyFieldOps,
  cleanFieldLabel,
  normalizeFieldLabel,
  type StudioFieldOp,
} from "@/lib/studio/entry-fields";

import {
  type BuilderDraft,
  type OpOf,
  quoted,
  TEMP_ID_PATTERN,
} from "./bundle-draft";

/**
 * Story settings and Bible entries for the chat's bundle candidate (change
 * records are in bundle-builder-changes.ts, plan items in
 * bundle-builder-plan.ts). Inputs mirror the strict-safe tool schemas:
 * every key is present, null means "not given". Each function validates
 * against the snapshot and the ops so far, records problems on the draft
 * (the whole call is then rejected), and otherwise adds or merges ops.
 * Repeated edits of one record merge into one op that keeps the first-seen
 * baseline.
 */

export type StorySettingsInput = {
  overview: string | null;
  instructions: string | null;
  theme: string | null;
  structureTemplate: StudioStructureTemplateId | null;
  structureNotes: string | null;
  style: {
    povAndTense: string | null;
    register: string | null;
    pacing: string | null;
    avoid: string | null;
    notes: string | null;
  } | null;
};

export type FieldEditInput = {
  action: "set" | "remove";
  label: string;
  value: string | null;
  steerOnly: boolean | null;
  backstoryOnly: boolean | null;
};

export type EntryItemInput = {
  op: "create" | "update" | "delete";
  entryId: string | null;
  tempId: string | null;
  type: StudioEntryType | null;
  customTypeLabel: string | null;
  name: string | null;
  summary: string | null;
  fields: FieldEditInput[] | null;
  relatedEntryIds: string[] | null;
};

const MAX_FIELD_OPS = 100;
const MAX_RELATED = 100;

const STORY_TEXT_LIMITS = {
  overview: 20_000,
  instructions: 8000,
  theme: 2000,
  structureNotes: 8000,
} as const;

const STORY_KEY_LABELS: Record<keyof StudioBundleStoryPatch, string> = {
  overview: "overview",
  instructions: "instructions",
  style: "style",
  theme: "theme",
  structureTemplate: "structure",
  structureNotes: "structure notes",
};

function typeLabel(type: StudioEntryType, customTypeLabel: string): string {
  if (type === "custom") return customTypeLabel.trim() || "entry";
  return type;
}

function cleanText(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function proposeStorySettings(
  draft: BuilderDraft,
  input: StorySettingsInput,
): void {
  const story = draft.snap.rows.story;
  if (Object.values(input).every((value) => value === null)) {
    draft.errors.push("give at least one setting to change");
    return;
  }
  const op = draft.find("story.update", () => true);
  const patch: StudioBundleStoryPatch = { ...(op?.patch ?? {}) };
  const baseline: OpOf<"story.update">["baseline"] = {
    ...(op?.baseline ?? {}),
  };
  for (const key of Object.keys(STORY_TEXT_LIMITS) as Array<
    keyof typeof STORY_TEXT_LIMITS
  >) {
    const value = input[key];
    if (value === null) continue;
    if (value.length > STORY_TEXT_LIMITS[key]) {
      draft.errors.push(
        `${key} must be at most ${STORY_TEXT_LIMITS[key]} characters`,
      );
      continue;
    }
    patch[key] = value.trim();
    if (!(key in baseline)) baseline[key] = story[key];
  }
  if (input.structureTemplate !== null) {
    patch.structureTemplate = input.structureTemplate;
    if (!("structureTemplate" in baseline)) {
      baseline.structureTemplate = story.structureTemplate;
    }
  }
  if (input.style !== null) {
    const next: StudioStyle = { ...(patch.style ?? story.style) };
    for (const key of Object.keys(next) as (keyof StudioStyle)[]) {
      const value = input.style[key];
      if (value !== null) next[key] = value.trim();
    }
    patch.style = next;
    if (!("style" in baseline)) baseline.style = story.style;
  }
  if (draft.errors.length > 0) return;

  for (const key of Object.keys(patch) as (keyof StudioBundleStoryPatch)[]) {
    if (isDeepStrictEqual(patch[key], story[key])) {
      delete patch[key];
      delete baseline[key];
    }
  }
  const keys = Object.keys(patch) as (keyof StudioBundleStoryPatch)[];
  if (keys.length === 0) {
    if (op) {
      draft.removeOp(
        op,
        "The story settings now match what is saved, so the settings change was dropped.",
      );
    } else {
      draft.errors.push("these settings already have those values");
    }
    return;
  }
  const label = `Update story settings: ${keys
    .map((key) => STORY_KEY_LABELS[key])
    .join(", ")}`;
  if (op) {
    op.patch = patch;
    op.baseline = baseline;
    op.label = label;
    draft.markChanged(op);
    return;
  }
  draft.addOp<OpOf<"story.update">>({
    kind: "story.update",
    label,
    patch,
    baseline,
  });
}

// --- Entries -----------------------------------------------------------------

type NewField = OpOf<"entry.create">["entry"]["fields"][number];

/** Field edits for a new entry's list: sets only, no repeated labels. */
function newEntryFields(
  draft: BuilderDraft,
  index: number,
  current: NewField[],
  edits: FieldEditInput[],
): NewField[] | null {
  const fields = current.map((field) => ({ ...field }));
  for (const edit of edits) {
    const label = cleanFieldLabel(edit.label);
    if (!label || label.length > 80) {
      draft.fail(index, "field labels must be 1 to 80 characters");
      return null;
    }
    const at = fields.findIndex(
      (field) =>
        normalizeFieldLabel(field.label) === normalizeFieldLabel(label),
    );
    if (edit.action === "remove") {
      if (at === -1) {
        draft.fail(index, `there is no field labelled “${label}” to remove`);
        return null;
      }
      fields.splice(at, 1);
      continue;
    }
    if (edit.value === null || edit.value.length > 20_000) {
      draft.fail(
        index,
        `field “${label}” needs a value of at most 20,000 characters`,
      );
      return null;
    }
    const next: NewField = {
      label: at === -1 ? label : fields[at].label,
      value: edit.value.trim(),
      steerOnly: edit.steerOnly ?? (at === -1 ? false : fields[at].steerOnly),
      backstoryOnly:
        edit.backstoryOnly ?? (at === -1 ? false : fields[at].backstoryOnly),
    };
    if (at === -1) fields.push(next);
    else fields[at] = next;
  }
  if (fields.length > STUDIO_MAX_ENTRY_FIELDS) {
    draft.fail(
      index,
      `an entry can hold at most ${STUDIO_MAX_ENTRY_FIELDS} fields; this would give it ${fields.length}`,
    );
    return null;
  }
  return fields;
}

function checkEntryRefs(
  draft: BuilderDraft,
  index: number,
  refs: string[],
  selfRef: string | null,
): string[] {
  const unique = [...new Set(refs.map((ref) => ref.trim()))];
  if (unique.length > MAX_RELATED) {
    draft.fail(index, `at most ${MAX_RELATED} entry ids are allowed`);
  }
  draft.defer(() => {
    for (const ref of unique) {
      if (ref === selfRef) {
        draft.fail(index, "an entry cannot list itself");
        continue;
      }
      const resolved = draft.entry(ref);
      if (!resolved.ok) draft.fail(index, resolved.error);
    }
  });
  return unique;
}

function sameFields(a: StudioEntryField[], b: StudioEntryField[]): boolean {
  const shape = (fields: StudioEntryField[]) =>
    fields.map(({ label, value, steerOnly, backstoryOnly }) => [
      label,
      value,
      steerOnly,
      backstoryOnly,
    ]);
  return isDeepStrictEqual(shape(a), shape(b));
}

function createEntry(draft: BuilderDraft, item: EntryItemInput, index: number) {
  const tempId = item.tempId?.trim() ?? "";
  if (item.entryId !== null) {
    return draft.fail(index, "create takes tempId, not entryId");
  }
  if (!TEMP_ID_PATTERN.test(tempId)) {
    return draft.fail(
      index,
      "create needs a tempId like new:short-name (letters, digits, _ . - only)",
    );
  }
  if (
    draft.find("entry.create", (op) => op.tempId === tempId) ||
    draft.find("plan.create", (op) => op.tempId === tempId)
  ) {
    return draft.fail(index, `tempId ${tempId} is already used in this turn`);
  }
  if (item.type === null) return draft.fail(index, "create needs a type");
  const name = cleanText(item.name);
  if (!name || name.length > 200) {
    return draft.fail(index, "create needs a name of 1 to 200 characters");
  }
  const customTypeLabel = cleanText(item.customTypeLabel);
  if (
    item.type === "custom" &&
    (!customTypeLabel || customTypeLabel.length > 60)
  ) {
    return draft.fail(
      index,
      "a custom entry needs a customTypeLabel of 1 to 60 characters, such as Group or Event",
    );
  }
  if (item.type !== "custom" && customTypeLabel) {
    return draft.fail(index, "customTypeLabel is only for type custom");
  }
  const summary = (item.summary ?? "").trim();
  if (summary.length > 20_000) {
    return draft.fail(index, "summary must be at most 20,000 characters");
  }
  const sameName = (otherType: StudioEntryType, otherName: string) =>
    otherType === item.type &&
    normalizeFieldLabel(otherName) === normalizeFieldLabel(name);
  const existing = [...draft.snap.entries.values()].find(
    (entry) =>
      sameName(entry.type, entry.name) &&
      !draft.find("entry.delete", (op) => op.entryId === entry.id),
  );
  if (existing) {
    return draft.fail(
      index,
      `an entry named ${quoted(name, "")} already exists (${existing.id}); update it instead`,
    );
  }
  if (
    draft.find("entry.create", (op) => sameName(op.entry.type, op.entry.name))
  ) {
    return draft.fail(
      index,
      `an entry named ${quoted(name, "")} is already proposed in this turn`,
    );
  }
  if (item.fields?.some((field) => field.action === "remove")) {
    return draft.fail(index, "a new entry has no fields to remove");
  }
  const fields = newEntryFields(draft, index, [], item.fields ?? []);
  if (!fields) return;
  const relatedEntryRefs = checkEntryRefs(
    draft,
    index,
    item.relatedEntryIds ?? [],
    tempId,
  );
  draft.addOp<OpOf<"entry.create">>(
    {
      kind: "entry.create",
      label: `Add ${typeLabel(item.type, customTypeLabel)} ${quoted(name, "Untitled")}`,
      tempId,
      entry: {
        type: item.type,
        customTypeLabel: item.type === "custom" ? customTypeLabel : "",
        name,
        summary,
        fields,
        relatedEntryRefs,
      },
    },
    tempId,
  );
}

/** Edits to an entry created earlier in this turn merge into its create. */
function updateNewEntry(
  draft: BuilderDraft,
  item: EntryItemInput,
  index: number,
  create: OpOf<"entry.create">,
) {
  const entry = { ...create.entry };
  if (item.type !== null && item.type !== entry.type) {
    return draft.fail(index, "an entry's type cannot change");
  }
  if (item.name !== null) {
    const name = cleanText(item.name);
    if (!name || name.length > 200) {
      return draft.fail(index, "name must be 1 to 200 characters");
    }
    entry.name = name;
  }
  if (item.summary !== null) {
    if (item.summary.length > 20_000) {
      return draft.fail(index, "summary must be at most 20,000 characters");
    }
    entry.summary = item.summary.trim();
  }
  if (item.customTypeLabel !== null) {
    const label = cleanText(item.customTypeLabel);
    if (entry.type !== "custom" || !label || label.length > 60) {
      return draft.fail(
        index,
        "customTypeLabel is only for custom entries (1 to 60 characters)",
      );
    }
    entry.customTypeLabel = label;
  }
  if (item.fields !== null) {
    const fields = newEntryFields(draft, index, entry.fields, item.fields);
    if (!fields) return;
    entry.fields = fields;
  }
  if (item.relatedEntryIds !== null) {
    entry.relatedEntryRefs = checkEntryRefs(
      draft,
      index,
      item.relatedEntryIds,
      create.tempId,
    );
  }
  create.entry = entry;
  create.label = `Add ${typeLabel(entry.type, entry.customTypeLabel)} ${quoted(entry.name, "Untitled")}`;
  draft.markChanged(create);
}

function updateEntry(draft: BuilderDraft, item: EntryItemInput, index: number) {
  const id = item.entryId?.trim() ?? "";
  if (!id) return draft.fail(index, "update needs entryId");
  if (item.tempId !== null) {
    return draft.fail(index, "update takes entryId; tempId is only for create");
  }
  if (isStudioBundleTempRef(id)) {
    const create = draft.find("entry.create", (op) => op.tempId === id);
    if (!create) {
      return draft.fail(
        index,
        `no entry with id ${id} is proposed in this turn`,
      );
    }
    return updateNewEntry(draft, item, index, create);
  }
  const entry = draft.snap.entries.get(id);
  if (!entry) return draft.fail(index, `there is no entry with id ${id}`);
  if (draft.find("entry.delete", (op) => op.entryId === id)) {
    return draft.fail(
      index,
      `entry ${id} is proposed for deletion in this turn`,
    );
  }
  if (item.type !== null && item.type !== entry.type) {
    return draft.fail(index, "an existing entry's type cannot change");
  }
  if (
    item.customTypeLabel !== null &&
    cleanText(item.customTypeLabel) !== entry.customTypeLabel
  ) {
    return draft.fail(
      index,
      "an existing entry's customTypeLabel cannot change here; ask the author",
    );
  }
  if (
    item.relatedEntryIds !== null &&
    !isDeepStrictEqual(
      [...new Set(item.relatedEntryIds.map((ref) => ref.trim()))].sort(),
      [...entry.relatedEntryIds].sort(),
    )
  ) {
    return draft.fail(
      index,
      "an existing entry's related entries cannot change here; ask the author",
    );
  }

  const op = draft.find(
    "entry.update",
    (candidate) => candidate.entryId === id,
  );
  const base = entry.fields;
  const fieldOps: StudioFieldOp[] = [...(op?.patch.fieldOps ?? [])];
  let current = applyFieldOps(base, fieldOps);
  for (const edit of item.fields ?? []) {
    const label = cleanFieldLabel(edit.label);
    if (!label || label.length > 80) {
      return draft.fail(index, "field labels must be 1 to 80 characters");
    }
    const existing = current.find(
      (field) =>
        normalizeFieldLabel(field.label) === normalizeFieldLabel(label),
    );
    let fieldOp: StudioFieldOp;
    if (edit.action === "remove") {
      if (!existing) {
        return draft.fail(index, `there is no field labelled “${label}”`);
      }
      fieldOp = { op: "remove", label };
    } else {
      if (edit.value === null || edit.value.length > 20_000) {
        return draft.fail(
          index,
          `field “${label}” needs a value of at most 20,000 characters`,
        );
      }
      fieldOp = {
        op: "set",
        label,
        value: edit.value.trim(),
        steerOnly: edit.steerOnly ?? existing?.steerOnly ?? false,
        backstoryOnly: edit.backstoryOnly ?? existing?.backstoryOnly ?? false,
      };
    }
    fieldOps.push(fieldOp);
    current = applyFieldOps(current, [fieldOp]);
  }
  if (fieldOps.length > MAX_FIELD_OPS) {
    return draft.fail(
      index,
      `at most ${MAX_FIELD_OPS} field edits per entry per turn`,
    );
  }
  if (
    current.length > STUDIO_MAX_ENTRY_FIELDS &&
    current.length > base.length
  ) {
    return draft.fail(
      index,
      `an entry can hold at most ${STUDIO_MAX_ENTRY_FIELDS} fields; this would give ${quoted(entry.name, "it")} ${current.length}`,
    );
  }

  const patch: OpOf<"entry.update">["patch"] = {
    fieldOps: sameFields(base, current) ? [] : fieldOps,
  };
  const name = item.name !== null ? cleanText(item.name) : op?.patch.name;
  if (name !== undefined) {
    if (!name || name.length > 200) {
      return draft.fail(index, "name must be 1 to 200 characters");
    }
    if (name !== entry.name) patch.name = name;
  }
  const summary =
    item.summary !== null ? item.summary.trim() : op?.patch.summary;
  if (summary !== undefined) {
    if (summary.length > 20_000) {
      return draft.fail(index, "summary must be at most 20,000 characters");
    }
    if (summary !== entry.summary) patch.summary = summary;
  }
  const empty =
    patch.name === undefined &&
    patch.summary === undefined &&
    patch.fieldOps.length === 0;
  if (empty) {
    if (op) {
      draft.removeOp(
        op,
        `The edit of ${quoted(entry.name, "the entry")} now matches what is saved, so it was dropped.`,
      );
      return;
    }
    return draft.fail(index, "this update changes nothing");
  }
  if (op) {
    op.patch = patch;
    draft.markChanged(op);
    return;
  }
  draft.addOp<OpOf<"entry.update">>(
    {
      kind: "entry.update",
      label: `Edit ${typeLabel(entry.type, entry.customTypeLabel)} ${quoted(entry.name, "Untitled")}`,
      entryId: id,
      baselineRevision: entry.revision,
      patch,
    },
    id,
  );
}

function deleteEntry(draft: BuilderDraft, item: EntryItemInput, index: number) {
  const id = item.entryId?.trim() ?? "";
  if (!id) return draft.fail(index, "delete needs entryId");
  if (isStudioBundleTempRef(id)) {
    return draft.fail(
      index,
      `${id} is new in this turn and cannot also be deleted`,
    );
  }
  const entry = draft.snap.entries.get(id);
  if (!entry) return draft.fail(index, `there is no entry with id ${id}`);
  if (draft.find("entry.delete", (op) => op.entryId === id)) {
    return draft.fail(index, `entry ${id} is already proposed for deletion`);
  }
  const users = draft.state.ops.filter((op) => {
    if (studioBundleOpRefs(op).entryRefs.includes(id)) return true;
    if (op.kind === "change.update" || op.kind === "change.delete") {
      return draft.snap.rows.changes.get(op.changeId)?.entryId === id;
    }
    return false;
  });
  if (users.length > 0) {
    return draft.fail(
      index,
      `other proposed changes still use this entry: ${users
        .map((op) => `“${op.label}”`)
        .join(", ")}`,
    );
  }
  const update = draft.find("entry.update", (op) => op.entryId === id);
  if (update) {
    draft.removeOp(
      update,
      `The earlier edit of ${quoted(entry.name, "the entry")} was dropped because it is now proposed for deletion.`,
    );
  }
  draft.addOp<OpOf<"entry.delete">>(
    {
      kind: "entry.delete",
      label: `Delete ${typeLabel(entry.type, entry.customTypeLabel)} ${quoted(entry.name, "Untitled")}`,
      entryId: id,
      baselineRevision: entry.revision,
    },
    id,
  );
}

export function proposeEntries(
  draft: BuilderDraft,
  items: EntryItemInput[],
): void {
  if (items.length === 0) draft.errors.push("items is empty");
  items.forEach((item, index) => {
    if (item.op === "create") createEntry(draft, item, index);
    else if (item.op === "update") updateEntry(draft, item, index);
    else deleteEntry(draft, item, index);
  });
}
