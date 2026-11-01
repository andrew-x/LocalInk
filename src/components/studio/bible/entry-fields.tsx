"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { STUDIO_ENTRY_SUGGESTIONS } from "@/lib/studio/bible-templates";
import type { StudioEntryDto, StudioEntryField } from "@/lib/studio/contracts";
import {
  cleanFieldLabel,
  normalizeFieldLabel,
} from "@/lib/studio/entry-fields";
import { generateId } from "@/lib/util";

import { BibleHeading } from "./bible-field";
import { usePatchEntry } from "./use-patch-entry";

const LABEL_MAX = 80;

type EntryFieldListProps = {
  entry: StudioEntryDto;
  /** Draft label and value by field id, falling back to the saved field. */
  labels: Record<string, string>;
  values: Record<string, string>;
  onLabelChange: (fieldId: string, label: string) => void;
  onValueChange: (fieldId: string, value: string) => void;
  onBlur: () => void;
  title: string;
};

function ToggleChip({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-caption text-muted-foreground">
      <input
        checked={checked}
        className="size-3.5 accent-primary"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

/**
 * The entry's AI-chosen fields: rename, edit, flag, reorder, delete, and add.
 * Text edits go through the caller's autosave drafts; structural changes save
 * at once, each rebuilt from the newest saved list.
 */
export function EntryFieldList({
  entry,
  labels,
  onBlur,
  onLabelChange,
  onValueChange,
  title,
  values,
}: EntryFieldListProps) {
  const patchEntry = usePatchEntry();
  const baseId = useId();
  const [newLabel, setNewLabel] = useState("");

  const present = new Set(
    entry.fields.map((field) => normalizeFieldLabel(field.label)),
  );
  const chips = STUDIO_ENTRY_SUGGESTIONS[entry.type].suggestions.filter(
    (suggestion) => !present.has(normalizeFieldLabel(suggestion.label)),
  );

  function editFields(
    change: (fields: StudioEntryField[]) => StudioEntryField[],
  ) {
    return patchEntry(entry.id, (latest) => ({
      fields: change(latest.fields),
    }));
  }

  function setFlag(
    fieldId: string,
    flag: "steerOnly" | "backstoryOnly",
    checked: boolean,
  ) {
    void editFields((fields) =>
      fields.map((field) =>
        field.id === fieldId ? { ...field, [flag]: checked } : field,
      ),
    );
  }

  function move(fieldId: string, direction: -1 | 1) {
    void editFields((fields) => {
      const index = fields.findIndex((field) => field.id === fieldId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= fields.length) return fields;
      const next = [...fields];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(fieldId: string) {
    void editFields((fields) => fields.filter((field) => field.id !== fieldId));
  }

  function add(
    label: string,
    flags: { steerOnly: boolean; backstoryOnly: boolean } = {
      steerOnly: false,
      backstoryOnly: false,
    },
  ) {
    const clean = cleanFieldLabel(label).slice(0, LABEL_MAX);
    if (!clean) return;
    void editFields((fields) =>
      fields.some(
        (field) =>
          normalizeFieldLabel(field.label) === normalizeFieldLabel(clean),
      )
        ? fields
        : [
            ...fields,
            {
              id: generateId("studio-field"),
              label: clean,
              value: "",
              author: "author",
              ...flags,
            },
          ],
    );
  }

  function submitNew() {
    add(newLabel);
    setNewLabel("");
  }

  const count = entry.fields.length;
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <BibleHeading>{title}</BibleHeading>
      {entry.fields.map((field, index) => {
        const valueId = `${baseId}-${field.id}`;
        return (
          <div
            className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2"
            key={field.id}
          >
            <div className="flex items-center gap-1">
              <Input
                aria-label="Field label"
                className="h-8 font-medium text-label-sm"
                maxLength={LABEL_MAX}
                onBlur={onBlur}
                onChange={(event) =>
                  onLabelChange(field.id, event.target.value)
                }
                value={labels[field.id] ?? field.label}
              />
              <Button
                aria-label={`Move ${field.label} up`}
                className="size-8 shrink-0"
                disabled={index === 0}
                onClick={() => move(field.id, -1)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowUp aria-hidden="true" className="size-3.5" />
              </Button>
              <Button
                aria-label={`Move ${field.label} down`}
                className="size-8 shrink-0"
                disabled={index === count - 1}
                onClick={() => move(field.id, 1)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ArrowDown aria-hidden="true" className="size-3.5" />
              </Button>
              <Button
                aria-label={`Delete ${field.label}`}
                className="size-8 shrink-0"
                onClick={() => remove(field.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
            <Label className="sr-only" htmlFor={valueId}>
              {field.label}
            </Label>
            <Textarea
              className="min-h-14"
              id={valueId}
              maxLength={20_000}
              onBlur={onBlur}
              onChange={(event) => onValueChange(field.id, event.target.value)}
              value={values[field.id] ?? field.value}
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <ToggleChip
                checked={field.steerOnly}
                label="AI uses, never says"
                onChange={(checked) => setFlag(field.id, "steerOnly", checked)}
              />
              <ToggleChip
                checked={field.backstoryOnly}
                label="Backstory only"
                onChange={(checked) =>
                  setFlag(field.id, "backstoryOnly", checked)
                }
              />
            </div>
          </div>
        );
      })}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitNew();
        }}
      >
        <Input
          aria-label="New field label"
          className="h-8"
          maxLength={LABEL_MAX}
          onChange={(event) => setNewLabel(event.target.value)}
          placeholder="Add a field, e.g. What she hides"
          value={newLabel}
        />
        <Button
          disabled={!cleanFieldLabel(newLabel)}
          size="sm"
          type="submit"
          variant="outline"
        >
          <Plus aria-hidden="true" />
          Add field
        </Button>
      </form>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((suggestion) => (
            <button
              className="cursor-pointer rounded-full border border-border px-2 py-0.5 text-caption text-muted-foreground transition-colors hover:border-ring/50 hover:bg-muted hover:text-foreground"
              key={suggestion.label}
              onClick={() => add(suggestion.label, suggestion)}
              title={suggestion.hint}
              type="button"
            >
              + {suggestion.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
