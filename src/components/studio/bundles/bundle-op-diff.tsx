"use client";

import { useMemo } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  isStudioBundleTempRef,
  type StudioBundleOpDto,
} from "@/lib/studio/bundle-contract";
import type {
  StudioEntryDto,
  StudioPlanItemDto,
  StudioProseDto,
} from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { type WordDiffSegment, wordDiff } from "./word-diff";

type DiffLine = {
  label: string;
  before: string | null;
  after: string | null;
};

type DiffModel = {
  lines: DiffLine[];
  note: string | null;
  prose: { before: string; after: string } | null;
};

type DiffContext = {
  entries: StudioEntryDto[];
  planItems: StudioPlanItemDto[];
  prose: StudioProseDto[];
  operations: StudioBundleOpDto[];
  /** False once the op is applied: store values are no longer "before". */
  live: boolean;
};

const STORY_KEY_LABEL: Record<string, string> = {
  overview: "Overview",
  instructions: "Instructions",
  style: "Style",
  theme: "Theme",
  structureTemplate: "Structure",
  structureNotes: "Structure notes",
};

const STYLE_KEY_LABEL: Record<string, string> = {
  povAndTense: "Point of view and tense",
  register: "Register",
  pacing: "Pacing",
  avoid: "Avoid",
  notes: "Notes",
};

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `${STYLE_KEY_LABEL[k] ?? k}: ${v}`)
      .join("\n");
  }
  return value === undefined || value === null ? "" : String(value);
}

function formatCraft(craft: Record<string, string>): string {
  return Object.entries(craft)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function entryName(ctx: DiffContext, ref: string): string {
  if (isStudioBundleTempRef(ref)) {
    const creator = ctx.operations.find(
      (op) => op.kind === "entry.create" && op.tempId === ref,
    );
    return creator?.kind === "entry.create"
      ? creator.entry.name
      : "a new entry";
  }
  return (
    ctx.entries.find((entry) => entry.id === ref)?.name ??
    "an entry that no longer exists"
  );
}

function planTitle(ctx: DiffContext, ref: string): string {
  if (isStudioBundleTempRef(ref)) {
    const creator = ctx.operations.find(
      (op) => op.kind === "plan.create" && op.tempId === ref,
    );
    if (creator?.kind !== "plan.create") return "a new item";
    return creator.item.title.trim() || `Untitled ${creator.item.kind}`;
  }
  const item = ctx.planItems.find((candidate) => candidate.id === ref);
  if (!item) return "an item that no longer exists";
  return item.title.trim() || `Untitled ${item.kind}`;
}

function names(ctx: DiffContext, refs: string[]): string {
  return refs.map((ref) => entryName(ctx, ref)).join(", ");
}

type RecordParts = {
  aspect: string;
  mode: string;
  about: string | null;
  value: string;
};

/** "Is at (about Mara) (adds): the snack bar", without the entry. */
function describeRecordBody(ctx: DiffContext, record: RecordParts): string {
  const about = record.about ? ` (about ${entryName(ctx, record.about)})` : "";
  const adds = record.mode === "add" ? " (adds)" : "";
  return `${record.aspect}${about}${adds}: ${record.value}`;
}

function buildModel(op: StudioBundleOpDto, ctx: DiffContext): DiffModel {
  const model: DiffModel = { lines: [], note: null, prose: null };
  const line = (label: string, before: string | null, after: string | null) => {
    model.lines.push({ label, before, after });
  };
  const live = <T,>(value: T): T | null => (ctx.live ? value : null);

  switch (op.kind) {
    case "story.update":
      for (const [key, value] of Object.entries(op.patch)) {
        line(
          STORY_KEY_LABEL[key] ?? key,
          formatValue((op.baseline as Record<string, unknown>)[key]),
          formatValue(value),
        );
      }
      break;
    case "entry.create": {
      const { entry } = op;
      line("Name", null, entry.name);
      line(
        "Type",
        null,
        entry.type === "custom" && entry.customTypeLabel
          ? entry.customTypeLabel
          : entry.type,
      );
      if (entry.summary.trim()) line("Summary", null, entry.summary);
      for (const field of entry.fields) line(field.label, null, field.value);
      if (entry.relatedEntryRefs.length > 0) {
        line("Related to", null, names(ctx, entry.relatedEntryRefs));
      }
      break;
    }
    case "entry.update": {
      const current = ctx.entries.find((e) => e.id === op.entryId);
      if (op.patch.name !== undefined) {
        line("Name", live(current?.name ?? null), op.patch.name);
      }
      if (op.patch.summary !== undefined) {
        line("Summary", live(current?.summary ?? null), op.patch.summary);
      }
      for (const fieldOp of op.patch.fieldOps) {
        const existing = current?.fields.find(
          (f) => f.label.trim().toLowerCase() === fieldOp.label.toLowerCase(),
        );
        if (fieldOp.op === "set") {
          line(fieldOp.label, live(existing?.value ?? null), fieldOp.value);
        } else {
          line(fieldOp.label, live(existing?.value ?? null), "(removed)");
        }
      }
      break;
    }
    case "entry.delete":
      model.note = `Deletes “${entryName(ctx, op.entryId)}” and removes it from related lists and scenes.`;
      break;
    case "plan.create": {
      const { item } = op;
      line("Kind", null, item.kind);
      if (item.parentRef) line("Inside", null, planTitle(ctx, item.parentRef));
      line("Title", null, item.title.trim() || `Untitled ${item.kind}`);
      if (item.whatHappens.trim()) {
        line("What happens", null, item.whatHappens);
      }
      if (item.howToWrite.trim()) line("How to write", null, item.howToWrite);
      const craft = formatCraft(item.craft);
      if (craft) line("Craft details", null, craft);
      if (item.presentEntryRefs.length > 0) {
        line("Who is in it", null, names(ctx, item.presentEntryRefs));
      }
      break;
    }
    case "plan.update": {
      const current = ctx.planItems.find((i) => i.id === op.itemId);
      const { patch } = op;
      if (patch.title !== undefined) {
        line("Title", live(current?.title ?? null), patch.title);
      }
      if (patch.whatHappens !== undefined) {
        line(
          "What happens",
          live(current?.whatHappens ?? null),
          patch.whatHappens,
        );
      }
      if (patch.howToWrite !== undefined) {
        line(
          "How to write",
          live(current?.howToWrite ?? null),
          patch.howToWrite,
        );
      }
      if (patch.craft !== undefined) {
        line(
          "Craft details",
          live(current ? formatCraft(current.craft) : null),
          formatCraft(patch.craft),
        );
      }
      if (patch.presentEntryIds !== undefined) {
        line(
          "Who is in it",
          live(current ? names(ctx, current.presentEntryIds) : null),
          names(ctx, patch.presentEntryIds),
        );
      }
      if (patch.tension !== undefined) {
        line(
          "Tension",
          live(current?.tension != null ? String(current.tension) : null),
          patch.tension === null ? "none" : String(patch.tension),
        );
      }
      break;
    }
    case "plan.move":
      model.note = `Moves “${planTitle(ctx, op.itemId)}” ${
        op.newParentRef
          ? `into “${planTitle(ctx, op.newParentRef)}”`
          : "to the top level"
      }, as item ${op.newIndex + 1}.`;
      break;
    case "plan.delete":
      model.note = `Deletes “${planTitle(ctx, op.itemId)}” and everything inside it, including any prose. You can undo right after.`;
      break;
    case "change.create":
      line(
        "New record",
        null,
        `${entryName(ctx, op.entryRef)}, ${describeRecordBody(ctx, {
          aspect: op.aspect,
          mode: op.mode,
          about: op.aboutEntryRef,
          value: op.value,
        })}`,
      );
      line("In", null, planTitle(ctx, op.planItemRef));
      break;
    case "change.update": {
      const before = op.baseline;
      const merged = { ...before, ...op.patch };
      line(
        "Record",
        describeRecordBody(ctx, {
          aspect: before.aspect,
          mode: before.mode,
          about: before.aboutEntryId,
          value: before.value,
        }),
        describeRecordBody(ctx, {
          aspect: merged.aspect,
          mode: merged.mode,
          about: merged.aboutEntryId,
          value: merged.value,
        }),
      );
      break;
    }
    case "change.delete":
      line(
        "Removes record",
        describeRecordBody(ctx, {
          aspect: op.baseline.aspect,
          mode: op.baseline.mode,
          about: op.baseline.aboutEntryId,
          value: op.baseline.value,
        }),
        null,
      );
      break;
    case "prose.write": {
      const current = isStudioBundleTempRef(op.momentRef)
        ? undefined
        : ctx.prose.find((p) => p.momentId === op.momentRef);
      model.prose = {
        before: ctx.live ? (current?.markdown ?? "") : "",
        after: op.markdown,
      };
      break;
    }
  }
  return model;
}

function Segments({ segments }: { segments: WordDiffSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => (
        <span
          className={cn(
            segment.type === "add" && "bg-primary/20 text-foreground",
            segment.type === "del" &&
              "bg-destructive/15 text-muted-foreground line-through",
          )}
          // Segments are positional and never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: static diff output.
          key={index}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

function ProseDiff({ before, after }: { before: string; after: string }) {
  const segments = useMemo(
    () => (before.trim() ? wordDiff(before, after) : null),
    [before, after],
  );
  return (
    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-card/40 p-2 font-content text-[0.9375rem] leading-6">
      {segments ? <Segments segments={segments} /> : after}
    </div>
  );
}

type BundleOpDiffProps = {
  op: StudioBundleOpDto;
  /** Every op of the bundle, to resolve temp ids to names. */
  operations: StudioBundleOpDto[];
  /** False once the bundle is resolved: only the new values are shown. */
  pending: boolean;
};

/** Field-level before/after for one op; prose gets a word-level diff. */
export function BundleOpDiff({ op, operations, pending }: BundleOpDiffProps) {
  const { state } = useStudioStore();
  const model = useMemo(
    () =>
      buildModel(op, {
        entries: state.entries,
        planItems: state.planItems,
        prose: state.prose,
        operations,
        live: pending,
      }),
    [op, operations, pending, state.entries, state.planItems, state.prose],
  );

  return (
    <div className="flex flex-col gap-2 text-caption">
      {model.note ? <p className="text-foreground/90">{model.note}</p> : null}
      {model.lines.map((line) => (
        <div className="flex flex-col gap-0.5" key={line.label}>
          <span className="font-semibold text-muted-foreground">
            {line.label}
          </span>
          {line.before?.trim() ? (
            <p className="whitespace-pre-wrap bg-destructive/10 px-1.5 py-0.5 text-muted-foreground line-through">
              {line.before}
            </p>
          ) : null}
          {line.after !== null ? (
            <p className="whitespace-pre-wrap bg-primary/10 px-1.5 py-0.5 text-foreground">
              {line.after.trim() ? line.after : "(empty)"}
            </p>
          ) : null}
        </div>
      ))}
      {model.prose ? (
        <ProseDiff after={model.prose.after} before={model.prose.before} />
      ) : null}
    </div>
  );
}
