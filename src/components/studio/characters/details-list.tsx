"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { Button } from "@/components/common/button";
import { PlainText } from "@/components/studio/outline/plain-text";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import type { StudioEntryDto, StudioEntryField } from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  normalizeFieldLabel,
} from "@/lib/studio/entry-fields";
import { cn, generateId } from "@/lib/util";

import { SectionHeading } from "./section-heading";
import { type EntryPatch, usePatchEntry } from "./use-patch-entry";

const FIELD_PREFIX = "field:";
const LABEL_PREFIX = "label:";
const LABEL_MAX = 80;
const NEW_DETAIL_LABEL = "New detail";

/** A label not used by any field yet: "New detail", "New detail 2", ... */
function freshLabel(fields: StudioEntryField[]): string {
  const taken = new Set(fields.map((f) => normalizeFieldLabel(f.label)));
  let label = NEW_DETAIL_LABEL;
  for (let n = 2; taken.has(normalizeFieldLabel(label)); n += 1) {
    label = `${NEW_DETAIL_LABEL} ${n}`;
  }
  return label;
}

function Pill({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "cursor-pointer whitespace-nowrap rounded-full border px-1.5 py-px text-caption leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
        active
          ? "border-accent/50 text-accent"
          : "border-border text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-focus-within/detail:opacity-100 group-hover/detail:opacity-100",
      )}
      onClick={onToggle}
      type="button"
    >
      {label}
    </button>
  );
}

/**
 * "Details the AI keeps": the entry's fields as "label: value" lines. Edits
 * save through `usePatchEntry`, each rebuilt from the newest saved list; the
 * server marks any changed field as the author's, so a refresh never
 * overwrites it.
 */
export function DetailsList({ entry }: { entry: StudioEntryDto }) {
  const patchEntry = usePatchEntry();
  const baseId = useId();
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);

  // A just-added detail takes focus with its label selected.
  useEffect(() => {
    if (!focusFieldId) return;
    const input = document.getElementById(`${baseId}-${focusFieldId}`);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
    setFocusFieldId(null);
  }, [baseId, focusFieldId]);

  const save = useCallback(
    async (changed: Partial<Record<string, string>>, final: boolean) => {
      const keep: string[] = [];
      const fieldEdits = new Map<string, string>();
      const labelEdits = new Map<string, string>();
      for (const [key, value] of Object.entries(changed)) {
        if (value === undefined) continue;
        if (key.startsWith(FIELD_PREFIX))
          fieldEdits.set(key.slice(FIELD_PREFIX.length), value);
        else if (key.startsWith(LABEL_PREFIX)) {
          const label = cleanFieldLabel(value).slice(0, LABEL_MAX);
          // A blank label, or one still being typed, stays local until blur.
          if (!label || (!final && label !== value)) keep.push(key);
          else labelEdits.set(key.slice(LABEL_PREFIX.length), label);
        }
      }
      if (fieldEdits.size > 0 || labelEdits.size > 0) {
        // Rebuild the full list from the newest saved entry.
        const saved = await patchEntry(entry.id, (latest) => ({
          fields: latest.fields.map((field) => {
            const value = fieldEdits.get(field.id);
            const label = labelEdits.get(field.id);
            return value === undefined && label === undefined
              ? field
              : {
                  ...field,
                  value: value ?? field.value,
                  label: label ?? field.label,
                };
          }),
        }));
        if (saved === null) return false;
      }
      return keep.length > 0 ? keep : true;
    },
    [entry.id, patchEntry],
  );

  const serverValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const field of entry.fields) {
      values[`${FIELD_PREFIX}${field.id}`] = field.value;
      values[`${LABEL_PREFIX}${field.id}`] = field.label;
    }
    return values;
  }, [entry.fields]);

  const { flush, setValue, values } = useAutosaveFields<string>({
    save,
    serverValues,
  });

  function editFields(
    change: (fields: StudioEntryField[]) => StudioEntryField[],
  ) {
    const patch = (latest: StudioEntryDto): EntryPatch => ({
      fields: change(latest.fields),
    });
    return patchEntry(entry.id, patch);
  }

  function toggle(fieldId: string, flag: "steerOnly" | "backstoryOnly") {
    void editFields((fields) =>
      fields.map((field) =>
        field.id === fieldId ? { ...field, [flag]: !field[flag] } : field,
      ),
    );
  }

  function remove(fieldId: string) {
    void editFields((fields) => fields.filter((field) => field.id !== fieldId));
  }

  async function add() {
    const id = generateId("studio-field");
    const saved = await editFields((fields) => [
      ...fields,
      {
        id,
        label: freshLabel(fields),
        value: "",
        author: "author",
        steerOnly: false,
        backstoryOnly: false,
      },
    ]);
    // The 40-field cap toasts from the patch hook and resolves null.
    if (saved) setFocusFieldId(id);
  }

  return (
    <section aria-label="Details the AI keeps" className="flex flex-col gap-1">
      <SectionHeading>Details the AI keeps</SectionHeading>
      {entry.fields.length === 0 ? (
        <p className="text-label-sm text-muted-foreground/80">
          Nothing yet. The AI adds details as it reads your story.
        </p>
      ) : null}
      <ul className="flex flex-col">
        {entry.fields.map((field) => (
          <li
            className="group/detail flex items-start gap-2 py-0.5 text-label-sm"
            key={field.id}
          >
            <input
              aria-label="Detail name"
              id={`${baseId}-${field.id}`}
              className="w-24 shrink-0 rounded-sm bg-transparent text-muted-foreground outline-none focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-muted/40"
              maxLength={LABEL_MAX}
              onBlur={() => void flush(true)}
              onChange={(event) =>
                setValue(`${LABEL_PREFIX}${field.id}`, event.target.value)
              }
              value={values[`${LABEL_PREFIX}${field.id}`] ?? field.label}
            />
            <div className="min-w-0 flex-1">
              <PlainText
                label={field.label}
                maxLength={20_000}
                onBlur={() => void flush(true)}
                onChange={(event) =>
                  setValue(`${FIELD_PREFIX}${field.id}`, event.target.value)
                }
                value={values[`${FIELD_PREFIX}${field.id}`] ?? field.value}
              />
            </div>
            <span className="flex shrink-0 items-center gap-1">
              <Pill
                active={field.steerOnly}
                label="never said outright"
                onToggle={() => toggle(field.id, "steerOnly")}
              />
              <Pill
                active={field.backstoryOnly}
                label="backstory"
                onToggle={() => toggle(field.id, "backstoryOnly")}
              />
              <button
                aria-label={`Delete ${field.label}`}
                className="rounded-sm p-0.5 text-muted-foreground opacity-0 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 group-focus-within/detail:opacity-100 group-hover/detail:opacity-100"
                onClick={() => remove(field.id)}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <Button
        className="h-6 self-start px-2 text-caption text-muted-foreground"
        onClick={() => void add()}
        size="sm"
        type="button"
        variant="ghost"
      >
        + detail
      </Button>
    </section>
  );
}
