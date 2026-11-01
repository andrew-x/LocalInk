"use client";

import { useState } from "react";

import { Button } from "@/components/common/button";
import { Textarea } from "@/components/common/textarea";
import { InspectPill } from "@/components/studio/inspect/inspect-section";
import type { StudioEntryFieldTemplate } from "@/lib/studio/bible-templates";

import { BibleFieldLabel, BibleHeading, NeverSaysPill } from "./bible-field";

type EntryFieldGroupProps = {
  entryId: string;
  fields: StudioEntryFieldTemplate[];
  /** Overrides a template label (a relationship names its two people). */
  labelFor?: (field: StudioEntryFieldTemplate) => string;
  onChange: (key: string, value: string) => void;
  onBlur: () => void;
  title: string;
  /** Field values by template key. */
  values: Record<string, string>;
};

/**
 * One group of template fields. Empty fields stay hidden behind "+ add field"
 * until the author adds one; a field that has been typed in stays visible.
 */
export function EntryFieldGroup({
  entryId,
  fields,
  labelFor,
  onBlur,
  onChange,
  title,
  values,
}: EntryFieldGroupProps) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const isVisible = (field: StudioEntryFieldTemplate) =>
    (values[field.key] ?? "").length > 0 || revealed.has(field.key);
  const visible = fields.filter(isVisible);
  const hidden = fields.filter((field) => !isVisible(field));

  function reveal(key: string) {
    setRevealed((current) => new Set(current).add(key));
    setFocusKey(key);
    setAdding(false);
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <BibleHeading>{title}</BibleHeading>
      {visible.map((field) => {
        const id = `bible-${entryId}-${field.key}`;
        return (
          <div className="flex flex-col gap-1" key={field.key}>
            <BibleFieldLabel
              hint={field.hint}
              htmlFor={id}
              pills={
                <>
                  {field.neverSays ? <NeverSaysPill /> : null}
                  {field.backstoryOnly ? (
                    <InspectPill>backstory only</InspectPill>
                  ) : null}
                </>
              }
            >
              {labelFor?.(field) ?? field.label}
            </BibleFieldLabel>
            <Textarea
              autoFocus={focusKey === field.key}
              className="min-h-14"
              id={id}
              maxLength={20_000}
              onBlur={onBlur}
              onChange={(event) => {
                setRevealed((current) => new Set(current).add(field.key));
                onChange(field.key, event.target.value);
              }}
              value={values[field.key] ?? ""}
            />
          </div>
        );
      })}
      {hidden.length > 0 ? (
        adding ? (
          <div className="flex flex-wrap items-center gap-1">
            {hidden.map((field) => (
              <Button
                className="h-7 px-2 text-caption"
                key={field.key}
                onClick={() => reveal(field.key)}
                size="sm"
                title={field.hint}
                type="button"
                variant="outline"
              >
                {labelFor?.(field) ?? field.label}
              </Button>
            ))}
            <Button
              className="h-7 px-2 text-caption"
              onClick={() => setAdding(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            className="h-6 self-start px-2 text-caption text-muted-foreground"
            onClick={() => setAdding(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            + add field
          </Button>
        )
      ) : null}
    </section>
  );
}
