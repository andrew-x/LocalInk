import type { ReactNode } from "react";

/** The small uppercase label above a group inside an entry card. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-semibold text-caption text-muted-foreground uppercase tracking-wide">
      {children}
    </h3>
  );
}
