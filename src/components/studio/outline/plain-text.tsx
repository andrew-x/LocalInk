"use client";

import { type ComponentProps, useId } from "react";

import { cn } from "@/lib/util";

type PlainTextProps = ComponentProps<"textarea"> & {
  /** Read by screen readers; the field itself shows no label. */
  label: string;
};

/**
 * A multi-line field that reads as plain text: no box, grows with its
 * content, and a faint wash only while focused. The outline's descriptions
 * and beats use it so writing in the plan feels like writing, not a form.
 */
export function PlainText({ className, id, label, ...props }: PlainTextProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <>
      <label className="sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        className={cn(
          "field-sizing-content block w-full resize-none rounded-sm bg-transparent p-0 text-label-sm font-normal leading-[1.45] outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-muted/40",
          className,
        )}
        id={fieldId}
        rows={1}
        {...props}
      />
    </>
  );
}
