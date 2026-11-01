"use client";

import { Textarea } from "@/components/common/textarea";
import { InspectPill } from "@/components/studio/inspect/inspect-section";
import type { StudioEntryField } from "@/lib/studio/contracts";

import { BibleFieldLabel, BibleHeading, NeverSaysPill } from "./bible-field";

type EntryFieldGroupProps = {
  entryId: string;
  fields: StudioEntryField[];
  onChange: (fieldId: string, value: string) => void;
  onBlur: () => void;
  title: string;
  /** Field values by field id. */
  values: Record<string, string>;
};

/** The entry's AI-chosen fields, in order. */
export function EntryFieldGroup({
  entryId,
  fields,
  onBlur,
  onChange,
  title,
  values,
}: EntryFieldGroupProps) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <BibleHeading>{title}</BibleHeading>
      {fields.map((field) => {
        const id = `bible-${entryId}-${field.id}`;
        return (
          <div className="flex flex-col gap-1" key={field.id}>
            <BibleFieldLabel
              htmlFor={id}
              pills={
                <>
                  {field.steerOnly ? <NeverSaysPill /> : null}
                  {field.backstoryOnly ? (
                    <InspectPill>backstory only</InspectPill>
                  ) : null}
                </>
              }
            >
              {field.label}
            </BibleFieldLabel>
            <Textarea
              className="min-h-14"
              id={id}
              maxLength={4000}
              onBlur={onBlur}
              onChange={(event) => onChange(field.id, event.target.value)}
              value={values[field.id] ?? ""}
            />
          </div>
        );
      })}
    </section>
  );
}
