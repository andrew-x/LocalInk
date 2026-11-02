"use client";

import { Eye, Pin, X } from "lucide-react";
import { useMemo } from "react";

import { EntryPicker } from "@/components/studio/shared/entry-picker";
import { chapterNumbers } from "@/components/studio/shared/inspect-labels";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { STUDIO_CHAT_MAX_PINNED_ENTRIES } from "@/lib/studio/chat-contract";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

const CHIP_CLASS =
  "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card/60 py-0.5 pr-1 pl-2 text-caption";
const REMOVE_CLASS =
  "shrink-0 rounded-full p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40";

/** "Ch 3: The pier", or a scene or moment title. */
export function planItemLabel(
  item: StudioPlanItemDto,
  numbers: Map<string, number>,
): string {
  const title = item.title.trim();
  if (item.kind === "chapter") {
    const chapter = `Ch ${numbers.get(item.id) ?? ""}`.trim();
    return title ? `${chapter}: ${title}` : chapter;
  }
  return title || `Untitled ${item.kind}`;
}

type ChatContextChipsProps = {
  /** The selected plan item the next turn will mention, or null. */
  lookingAtItemId: string | null;
  onDismissLookingAt: () => void;
  pinnedEntryIds: string[];
  onPin: (entryId: string) => void;
  onUnpin: (entryId: string) => void;
};

/**
 * What the next turn is pointed at: the selection as a removable hint (back
 * for the following turn) and the entries pinned for focus.
 */
export function ChatContextChips({
  lookingAtItemId,
  onDismissLookingAt,
  pinnedEntryIds,
  onPin,
  onUnpin,
}: ChatContextChipsProps) {
  const { state } = useStudioStore();
  const { entries, planItems } = state;
  const numbers = useMemo(() => chapterNumbers(planItems), [planItems]);
  const lookingAt = lookingAtItemId
    ? planItems.find((item) => item.id === lookingAtItemId)
    : undefined;
  const pinned = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return pinnedEntryIds.flatMap((id) => byId.get(id) ?? []);
  }, [entries, pinnedEntryIds]);
  const pinnedIds = new Set(pinned.map((entry) => entry.id));
  const candidates = entries.filter((entry) => !pinnedIds.has(entry.id));
  const atCap = pinned.length >= STUDIO_CHAT_MAX_PINNED_ENTRIES;

  return (
    <>
      {lookingAt ? (
        <span className={CHIP_CLASS}>
          <Eye aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">
            Looking at: {planItemLabel(lookingAt, numbers)}
          </span>
          <button
            aria-label="Leave the selection out of the next message"
            className={REMOVE_CLASS}
            onClick={onDismissLookingAt}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ) : null}
      {pinned.map((entry) => (
        <span className={CHIP_CLASS} key={entry.id}>
          <Pin aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{entry.name || "Untitled"}</span>
          <button
            aria-label={`Unpin ${entry.name || "this entry"}`}
            className={REMOVE_CLASS}
            onClick={() => onUnpin(entry.id)}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      {atCap ? null : (
        <EntryPicker entries={candidates} label="Pin entry" onPick={onPin} />
      )}
    </>
  );
}
