import type { ReactNode } from "react";

import { cn } from "@/lib/util";

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
