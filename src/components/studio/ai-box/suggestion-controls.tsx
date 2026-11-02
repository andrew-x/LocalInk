"use client";

import { Check, X } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/common/button";
import {
  bundleIssueText,
  useResolveBundle,
} from "@/components/studio/bundles/use-resolve-bundle";
import { wordDiff } from "@/components/studio/bundles/word-diff";
import { cn } from "@/lib/util";

/**
 * DOM id of an op's in-place suggestion (outline line, entry card, draft
 * beat). Op ids repeat across bundles, so the bundle id is part of it.
 */
export function suggestionAnchorId(bundleId: string, opId: string): string {
  return `studio-suggestion-${bundleId}-${opId}`;
}

/** DOM id of an op's row in the conversation panel. */
export function suggestionRowId(bundleId: string, opId: string): string {
  return `studio-op-row-${bundleId}-${opId}`;
}

/**
 * Scrolls an element into view and briefly rings it, once it renders (it
 * may wait for a line or card to open). If it never does, `fallbackId` is
 * scrolled to instead.
 */
export function revealElement(id: string, attempts = 4, fallbackId?: string) {
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    if (!element) {
      if (attempts > 1) revealElement(id, attempts - 1, fallbackId);
      else if (fallbackId) {
        document
          .getElementById(fallbackId)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const color = getComputedStyle(element)
      .getPropertyValue("--studio-proposed")
      .trim();
    if (!color) return;
    element.animate(
      [
        { boxShadow: `0 0 0 2px ${color}` },
        { boxShadow: "0 0 0 2px transparent" },
      ],
      { duration: 1800, easing: "ease-out" },
    );
  });
}

type SuggestionButtonsProps = {
  bundleId: string;
  opId: string;
  /** The op's label, for the buttons' accessible names. */
  label: string;
  className?: string;
};

/** ✓ Accept / ✕ Dismiss for one op, applied immediately. */
export function SuggestionButtons({
  bundleId,
  className,
  label,
  opId,
}: SuggestionButtonsProps) {
  const { busy, resolve } = useResolveBundle();
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
      <Button
        aria-label={`Accept: ${label}`}
        className="size-6 text-studio-proposed hover:text-studio-proposed"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          void resolve(bundleId, "accept", [opId]);
        }}
        size="icon"
        tooltip="Accept"
        type="button"
        variant="ghost"
      >
        <Check aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        aria-label={`Dismiss: ${label}`}
        className="size-6"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          void resolve(bundleId, "reject", [opId]);
        }}
        size="icon"
        tooltip="Dismiss"
        type="button"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </span>
  );
}

/** Why the last accept could not apply this op, when it named it. */
export function SuggestionIssues({
  bundleId,
  className,
  opId,
}: {
  bundleId: string;
  opId: string;
  className?: string;
}) {
  const { issuesFor } = useResolveBundle();
  const issues = issuesFor(bundleId, opId);
  if (issues.length === 0) return null;
  const texts = [...new Set(issues.map(bundleIssueText))];
  return (
    <p
      className={cn("font-sans text-caption text-destructive", className)}
      role="alert"
    >
      {texts.join(" ")}
    </p>
  );
}

/** The violet "N suggestions" pill on a collapsed line. */
export function SuggestionsTag({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-studio-proposed/12 px-1.5 font-normal text-[0.6875rem] text-studio-proposed leading-[1.125rem]">
      {count} {count === 1 ? "suggestion" : "suggestions"}
    </span>
  );
}

/** A word diff in running text: removed words struck, added ones tinted violet. */
export function DiffText({ before, after }: { before: string; after: string }) {
  const segments = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, index) => (
        <span
          className={cn(
            segment.type === "add" &&
              "rounded-[2px] bg-studio-proposed/20 text-foreground",
            segment.type === "del" && "text-muted-foreground/80 line-through",
          )}
          // Segments are positional and never reorder.
          // biome-ignore lint/suspicious/noArrayIndexKey: static diff output.
          key={index}
        >
          {segment.text}
        </span>
      ))}
    </span>
  );
}
