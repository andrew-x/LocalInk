"use client";

import { ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  type StudioBundleOpDtoOf,
  useBundlePreview,
} from "@/components/studio/bundles/use-bundle-preview";
import type { StudioEntryDto, StudioEntryType } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import {
  DiffText,
  SuggestionButtons,
  SuggestionIssues,
  suggestionAnchorId,
} from "./suggestion-controls";

export type EntryGroup = "characters" | "places" | "other";

export function entryGroupOf(type: StudioEntryType): EntryGroup {
  if (type === "character") return "characters";
  if (type === "place") return "places";
  return "other";
}

const FRAME =
  "rounded-md border border-studio-proposed/45 bg-studio-proposed/8 font-normal text-label-sm";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The entry.create ops proposed for one group of Characters & places. */
export function useProposedEntries(
  group: EntryGroup,
): StudioBundleOpDtoOf<"entry.create">[] {
  const preview = useBundlePreview();
  return useMemo(
    () =>
      preview.proposedEntries.filter(
        (op) => entryGroupOf(op.entry.type) === group,
      ),
    [group, preview.proposedEntries],
  );
}

/** How many pending ops edit or delete a saved entry. */
export function useEntrySuggestionCount(entryId: string): number {
  return useBundlePreview().entryOpsByEntryId.get(entryId)?.length ?? 0;
}

/**
 * A proposed new entry as a violet line at the top of its group, with
 * ✓/✕. It opens to show the whole paragraph the AI wrote.
 */
export function ProposedEntryLine({
  op,
}: {
  op: StudioBundleOpDtoOf<"entry.create">;
}) {
  const preview = useBundlePreview();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const bundleId = preview.bundleId;
  if (!bundleId) return null;
  const { entry } = op;
  const summary = entry.summary.trim();
  const details = entry.fields.length;
  return (
    <div
      className={cn(FRAME, "my-0.5 px-2 py-0.5")}
      id={suggestionAnchorId(bundleId, op.id)}
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        <button
          aria-controls={open ? bodyId : undefined}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true" className="font-bold text-studio-proposed">
            +
          </span>
          <span className="sr-only">New: </span>
          <span className="max-w-[55%] shrink-0 truncate font-semibold">
            {entry.name}
          </span>
          {open ? null : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
              {summary}
            </span>
          )}
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "ml-auto size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <SuggestionButtons bundleId={bundleId} label={op.label} opId={op.id} />
      </div>
      {open ? (
        <div className="flex flex-col gap-1 pb-1.5 pl-4" id={bodyId}>
          {summary ? (
            <p className="whitespace-pre-wrap leading-[1.5]">{entry.summary}</p>
          ) : null}
          {details > 0 ? (
            <p className="text-caption text-muted-foreground">
              plus {plural(details, "detail")} the AI keeps
            </p>
          ) : null}
        </div>
      ) : null}
      <SuggestionIssues bundleId={bundleId} className="pb-1" opId={op.id} />
    </div>
  );
}

/**
 * Pending edits and deletes of an open entry, inside its card: the name and
 * paragraph as word diffs (details count as "plus N details"), or a delete
 * note, each with ✓/✕.
 */
export function EntryOpSuggestions({ entry }: { entry: StudioEntryDto }) {
  const preview = useBundlePreview();
  const ops = preview.entryOpsByEntryId.get(entry.id) ?? [];
  const bundleId = preview.bundleId;
  if (ops.length === 0 || !bundleId) return null;
  return (
    <div className="flex flex-col gap-1">
      {ops.map((op) => {
        if (op.kind !== "entry.update" && op.kind !== "entry.delete") {
          return null;
        }
        const { name, summary, fieldOps } =
          op.kind === "entry.update"
            ? op.patch
            : { name: undefined, summary: undefined, fieldOps: [] };
        const showName = name !== undefined && name !== entry.name;
        const showSummary = summary !== undefined && summary !== entry.summary;
        const details = fieldOps.length;
        return (
          <div
            className={cn(FRAME, "px-2 py-1 leading-[1.5]")}
            id={suggestionAnchorId(bundleId, op.id)}
            key={op.id}
          >
            <div className="flex min-h-6 min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 text-caption text-studio-proposed">
                {op.kind === "entry.delete"
                  ? "Delete this entry and everything tracked for it"
                  : "Suggested edit"}
              </span>
              <SuggestionButtons
                bundleId={bundleId}
                label={op.label}
                opId={op.id}
              />
            </div>
            {showName ? (
              <p>
                <span className="text-muted-foreground">Name: </span>
                <DiffText after={name ?? ""} before={entry.name} />
              </p>
            ) : null}
            {showSummary ? (
              <p>
                <DiffText after={summary ?? ""} before={entry.summary} />
              </p>
            ) : null}
            {details > 0 ? (
              <p className="text-caption text-muted-foreground">
                {showName || showSummary ? "plus " : ""}
                {plural(details, "detail")} the AI keeps
              </p>
            ) : null}
            <SuggestionIssues bundleId={bundleId} opId={op.id} />
          </div>
        );
      })}
    </div>
  );
}
