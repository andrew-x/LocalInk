import type { ReactNode } from "react";

import { STUDIO_ENTRY_SUGGESTIONS } from "@/lib/studio/bible-templates";
import type { StudioEntryDto, StudioPlanItemDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

/** "Character", "Place", or a custom entry's own label. */
export function entryKindLabel(entry: StudioEntryDto): string {
  return entry.type === "custom"
    ? entry.customTypeLabel.trim() || "Custom"
    : STUDIO_ENTRY_SUGGESTIONS[entry.type].label;
}

/**
 * How many distinct scenes each entry is in: the scene itself, or any of its
 * beats, lists the entry as present.
 */
export function sceneCountsByEntry(
  planItems: StudioPlanItemDto[],
): Map<string, number> {
  const scenesByEntry = new Map<string, Set<string>>();
  for (const item of planItems) {
    if (item.kind === "chapter") continue;
    const sceneId = item.kind === "scene" ? item.id : item.parentId;
    if (!sceneId) continue;
    for (const entryId of item.presentEntryIds) {
      const scenes = scenesByEntry.get(entryId) ?? new Set<string>();
      scenes.add(sceneId);
      scenesByEntry.set(entryId, scenes);
    }
  }
  return new Map([...scenesByEntry].map(([id, set]) => [id, set.size]));
}

export function sceneCountLabel(count: number): string {
  return `${count} ${count === 1 ? "scene" : "scenes"}`;
}

type EntryLineProps = {
  entry: StudioEntryDto;
  sceneCount: number;
  /** Show the entry's kind, for the mixed "Other" group. */
  showKind?: boolean;
  onOpen: () => void;
  /** Small pills, such as "1 suggestion". */
  tags?: ReactNode;
};

/** One line: avatar initial, name, the start of the paragraph, "N scenes". */
export function EntryLine({
  entry,
  onOpen,
  sceneCount,
  showKind = false,
  tags,
}: EntryLineProps) {
  const name = entry.name.trim() || "Untitled";
  return (
    <button
      className="flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2 text-left font-normal text-label-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={onOpen}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 shrink-0 place-items-center font-bold text-[10.5px]",
          entry.type === "character" &&
            "rounded-full bg-primary/25 text-primary",
          entry.type === "place" &&
            "rounded-[5px] bg-studio-status-flagged/25 text-studio-status-flagged",
          entry.type !== "character" &&
            entry.type !== "place" &&
            "rounded-[5px] bg-muted text-muted-foreground",
        )}
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <span className="max-w-[60%] shrink-0 truncate font-semibold">
        {name}
      </span>
      {showKind ? (
        <span className="shrink-0 text-caption text-muted-foreground/80">
          {entryKindLabel(entry)}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
        {entry.summary}
      </span>
      {sceneCount > 0 ? (
        <span className="shrink-0 text-caption text-muted-foreground/80 tabular-nums">
          {sceneCountLabel(sceneCount)}
        </span>
      ) : null}
      {tags}
    </button>
  );
}
