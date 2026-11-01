import type { ReactNode } from "react";

import { cn } from "@/lib/util";

type InspectSectionProps = {
  children: ReactNode;
  className?: string;
  /** Right-aligned note in the header. */
  meta?: ReactNode;
  title: string;
};

export function InspectSection({
  children,
  className,
  meta,
  title,
}: InspectSectionProps) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex flex-col gap-1.5 border-border/60 border-t pt-3",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-caption text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        {meta ? (
          <span className="text-caption text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A small rounded tag, used for planned/confirmed and AI/author pills. */
export function InspectPill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "accent";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-px text-caption leading-4",
        tone === "muted" && "border-border text-muted-foreground",
        tone === "primary" && "border-primary/40 text-primary",
        tone === "accent" && "border-accent/50 text-accent",
      )}
    >
      {children}
    </span>
  );
}
