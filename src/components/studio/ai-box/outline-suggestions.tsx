"use client";

import type { ReactNode } from "react";

import {
  type BundlePreview,
  type ProposedPlanItem,
  type StudioBundleOpDtoOf,
  useBundlePreview,
} from "@/components/studio/bundles/use-bundle-preview";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  isStudioBundleTempRef,
  type StudioBundleOpDto,
} from "@/lib/studio/bundle-contract";
import type { StudioEntryDto, StudioPlanItemDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import {
  DiffText,
  SuggestionButtons,
  SuggestionIssues,
  suggestionAnchorId,
} from "./suggestion-controls";

/** A line in a list of saved lines with the proposed ones placed among them. */
export type PlacedLine<T> =
  | { type: "saved"; item: T }
  | { type: "proposed"; item: ProposedPlanItem };

/**
 * Places proposed creates among saved siblings the way accept will: after
 * their `afterRef` (saved or proposed), else at the end, in op order.
 */
export function placeProposed<T extends { id: string }>(
  saved: T[],
  proposed: ProposedPlanItem[],
): PlacedLine<T>[] {
  const lines: PlacedLine<T>[] = saved.map((item) => ({ type: "saved", item }));
  for (const item of proposed) {
    const index =
      item.afterRef === null
        ? -1
        : lines.findIndex(
            (line) =>
              (line.type === "saved" ? line.item.id : line.item.tempId) ===
              item.afterRef,
          );
    if (index < 0) lines.push({ type: "proposed", item });
    else lines.splice(index + 1, 0, { type: "proposed", item });
  }
  return lines;
}

export type OutlineSuggestions = {
  /** Proposed creates under a parent (a saved id, a temp id, or null). */
  proposedUnder: (parentRef: string | null) => ProposedPlanItem[];
  /** Pending update / move / delete ops on a saved item. */
  opsOn: (itemId: string) => StudioBundleOpDto[];
  /**
   * Suggestions that show inside an item's expanded view (its scenes,
   * beats and their proposed children), for the "N suggestions" tag on
   * its collapsed line. The item's own ops show on its line instead.
   */
  insideCount: (itemId: string) => number;
};

function computeOutlineSuggestions(
  preview: BundlePreview,
  planItems: StudioPlanItemDto[],
): OutlineSuggestions {
  const byId = new Map(planItems.map((item) => [item.id, item]));
  const proposedByParent = new Map<string | null, ProposedPlanItem[]>();
  const byTempId = new Map<string, ProposedPlanItem>();
  for (const item of preview.proposedPlanItems) {
    byTempId.set(item.tempId, item);
    const list = proposedByParent.get(item.parentRef);
    if (list) list.push(item);
    else proposedByParent.set(item.parentRef, [item]);
  }

  const insideCounts = new Map<string, number>();
  const bump = (containerId: string | null) => {
    const seen = new Set<string>();
    let current = containerId ? byId.get(containerId) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      insideCounts.set(current.id, (insideCounts.get(current.id) ?? 0) + 1);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  };
  for (const [itemId, ops] of preview.planOpsByItemId) {
    const container = byId.get(itemId)?.parentId ?? null;
    for (let i = 0; i < ops.length; i++) bump(container);
  }
  for (const item of preview.proposedPlanItems) {
    // A proposed child nests under its proposed parent's line; it counts
    // toward the first saved item that line shows inside.
    const seen = new Set<string>();
    let parent = item.parentRef;
    while (parent && isStudioBundleTempRef(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = byTempId.get(parent)?.parentRef ?? null;
    }
    bump(parent && !isStudioBundleTempRef(parent) ? parent : null);
  }

  return {
    proposedUnder: (parentRef) => proposedByParent.get(parentRef) ?? [],
    opsOn: (itemId) => preview.planOpsByItemId.get(itemId) ?? [],
    insideCount: (itemId) => insideCounts.get(itemId) ?? 0,
  };
}

const suggestionsCache = new WeakMap<
  BundlePreview,
  WeakMap<StudioPlanItemDto[], OutlineSuggestions>
>();

/** The outline's view of the pending suggestions, computed once per change. */
export function useOutlineSuggestions(): OutlineSuggestions {
  const { state } = useStudioStore();
  const preview = useBundlePreview();
  const { planItems } = state;
  let byItems = suggestionsCache.get(preview);
  if (!byItems) {
    byItems = new WeakMap();
    suggestionsCache.set(preview, byItems);
  }
  let suggestions = byItems.get(planItems);
  if (!suggestions) {
    suggestions = computeOutlineSuggestions(preview, planItems);
    byItems.set(planItems, suggestions);
  }
  return suggestions;
}

const FRAME =
  "rounded-md border border-studio-proposed/45 bg-studio-proposed/8 font-normal";

function startOf(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/**
 * A proposed chapter, scene or beat as a violet line where accept would put
 * it, with ✓/✕. Its own proposed children nest under it; accepting one of
 * them brings this create along, and dismissing this dismisses them.
 */
export function SuggestionLine({ item }: { item: ProposedPlanItem }) {
  const { proposedUnder } = useOutlineSuggestions();
  const children = proposedUnder(item.tempId);
  const isBeat = item.kind === "moment";
  const title =
    item.title.trim() ||
    (item.kind === "chapter" ? "Untitled chapter" : "Untitled scene");
  const main = isBeat ? startOf(item.whatHappens) || item.label : title;
  const kindLabel =
    item.kind === "chapter"
      ? "New chapter"
      : item.kind === "scene"
        ? "New scene"
        : "New beat";

  return (
    <div
      className={cn(FRAME, "my-0.5 px-2 py-0.5")}
      id={suggestionAnchorId(item.bundleId, item.opId)}
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <span aria-hidden="true" className="font-bold text-studio-proposed">
          +
        </span>
        <span className="sr-only">{kindLabel}: </span>
        <span
          className={cn(
            "min-w-0 text-foreground/90",
            isBeat ? "flex-1 truncate" : "max-w-[60%] shrink-0 truncate",
            item.kind === "chapter" && "font-semibold",
            item.kind === "scene" && "font-medium",
          )}
        >
          {main}
        </span>
        {isBeat ? null : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
            {startOf(item.whatHappens)}
          </span>
        )}
        <SuggestionButtons
          bundleId={item.bundleId}
          label={item.label}
          opId={item.opId}
        />
      </div>
      <SuggestionIssues
        bundleId={item.bundleId}
        className="pb-1"
        opId={item.opId}
      />
      {children.length > 0 ? (
        <div className="flex flex-col pb-1 pl-4">
          {children.map((child) => (
            <SuggestionLine item={child} key={child.opId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function entryNames(
  refs: string[],
  entries: StudioEntryDto[],
  preview: BundlePreview,
): string {
  return refs
    .map((ref) => {
      if (isStudioBundleTempRef(ref)) {
        return (
          preview.proposedEntries.find((op) => op.tempId === ref)?.entry.name ??
          "someone new"
        );
      }
      return entries.find((entry) => entry.id === ref)?.name ?? "";
    })
    .filter(Boolean)
    .join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The frame around an in-place change: a heading row with ✓/✕, then its body. */
function SuggestionBox({
  children,
  heading,
  op,
  bundleId,
}: {
  children?: ReactNode;
  heading: ReactNode;
  op: StudioBundleOpDto;
  bundleId: string;
}) {
  return (
    <div
      className={cn(FRAME, "my-0.5 px-2 py-1 text-label-sm leading-[1.45]")}
      id={suggestionAnchorId(bundleId, op.id)}
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 text-caption text-studio-proposed">
          {heading}
        </span>
        <SuggestionButtons bundleId={bundleId} label={op.label} opId={op.id} />
      </div>
      {children}
      <SuggestionIssues bundleId={bundleId} opId={op.id} />
    </div>
  );
}

/**
 * A suggested edit to a saved line, inline under it: the title and the
 * description as word diffs. Hidden scaffolding (how to write it, craft,
 * a beat's title) only counts as "behind-the-scenes changes".
 */
export function SuggestionDiff({
  bundleId,
  item,
  op,
}: {
  bundleId: string;
  item: StudioPlanItemDto;
  op: StudioBundleOpDtoOf<"plan.update">;
}) {
  const { state } = useStudioStore();
  const preview = useBundlePreview();
  const { patch } = op;
  const isBeat = item.kind === "moment";
  const showTitle =
    !isBeat && patch.title !== undefined && patch.title !== item.title;
  const showText =
    patch.whatHappens !== undefined && patch.whatHappens !== item.whatHappens;
  const cast =
    patch.presentEntryIds !== undefined
      ? entryNames(patch.presentEntryIds, state.entries, preview)
      : null;
  const hidden =
    (patch.howToWrite !== undefined ? 1 : 0) +
    (patch.craft !== undefined ? 1 : 0) +
    (isBeat && patch.title !== undefined ? 1 : 0);
  const visible = showTitle || showText || cast !== null;

  return (
    <SuggestionBox bundleId={bundleId} heading="Suggested edit" op={op}>
      {showTitle ? (
        <p>
          <span className="text-muted-foreground">Title: </span>
          <DiffText after={patch.title ?? ""} before={item.title} />
        </p>
      ) : null}
      {showText ? (
        <p>
          <DiffText after={patch.whatHappens ?? ""} before={item.whatHappens} />
        </p>
      ) : null}
      {cast !== null ? (
        <p>
          <span className="text-muted-foreground">Who&apos;s in it: </span>
          {cast || "no one"}
        </p>
      ) : null}
      {hidden > 0 ? (
        <p className="text-caption text-muted-foreground">
          {visible
            ? `plus ${plural(hidden, "behind-the-scenes change")}`
            : plural(hidden, "behind-the-scenes change")}
        </p>
      ) : null}
    </SuggestionBox>
  );
}

function planTitle(
  ref: string,
  planItems: StudioPlanItemDto[],
  preview: BundlePreview,
): string {
  if (isStudioBundleTempRef(ref)) {
    const proposed = preview.proposedPlanItems.find((p) => p.tempId === ref);
    return proposed?.title.trim() || "a new item";
  }
  const item = planItems.find((candidate) => candidate.id === ref);
  return item?.title.trim() || `an untitled ${item?.kind ?? "item"}`;
}

/** A suggested move or delete of a saved line, as a violet note under it. */
export function SuggestionNote({
  bundleId,
  item,
  op,
}: {
  bundleId: string;
  item: StudioPlanItemDto;
  op: StudioBundleOpDtoOf<"plan.move"> | StudioBundleOpDtoOf<"plan.delete">;
}) {
  const { state } = useStudioStore();
  const preview = useBundlePreview();
  const noun = item.kind === "moment" ? "beat" : item.kind;
  const heading =
    op.kind === "plan.delete"
      ? `Delete this ${noun}${item.kind === "moment" ? "" : " and everything in it"}`
      : `Move ${
          op.newParentRef
            ? `into “${planTitle(op.newParentRef, state.planItems, preview)}”`
            : "to the top level"
        }, as ${noun} ${op.newIndex + 1}`;
  return <SuggestionBox bundleId={bundleId} heading={heading} op={op} />;
}

/** Every pending update / move / delete on a saved line, inline under it. */
export function ItemSuggestions({
  className,
  item,
}: {
  className?: string;
  item: StudioPlanItemDto;
}) {
  const preview = useBundlePreview();
  const { opsOn } = useOutlineSuggestions();
  const ops = opsOn(item.id);
  const bundleId = preview.bundleId;
  if (ops.length === 0 || !bundleId) return null;
  return (
    <div className={className}>
      {ops.map((op) =>
        op.kind === "plan.update" ? (
          <SuggestionDiff bundleId={bundleId} item={item} key={op.id} op={op} />
        ) : op.kind === "plan.move" || op.kind === "plan.delete" ? (
          <SuggestionNote bundleId={bundleId} item={item} key={op.id} op={op} />
        ) : null,
      )}
    </div>
  );
}
