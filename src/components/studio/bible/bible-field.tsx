import type { ReactNode } from "react";

import { Label } from "@/components/common/label";
import { InspectPill } from "@/components/studio/shared/inspect-pill";

/** Pill for fields that steer the AI but must never be narrated. */
export function NeverSaysPill() {
  return <InspectPill tone="accent">AI uses, never says</InspectPill>;
}

export function BibleFieldLabel({
  children,
  hint,
  htmlFor,
  pills,
}: {
  children: ReactNode;
  hint?: string;
  htmlFor: string;
  pills?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <Label className="font-medium text-label-sm" htmlFor={htmlFor}>
        {children}
      </Label>
      {pills}
      {hint ? (
        <span className="text-caption text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function BibleHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-semibold text-caption text-muted-foreground uppercase tracking-wide">
      {children}
    </h3>
  );
}
