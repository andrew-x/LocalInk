"use client";

import { X } from "lucide-react";
import { useMemo } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  EMPTY_STUDIO_STYLE,
  type StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { getInstructionStack } from "@/lib/studio/instructions";

import { EntryPicker } from "./entry-picker";
import { InspectSection } from "./inspect-section";
import { usePatchPlanItem } from "./use-patch-plan-item";

const LAYER_LABEL = {
  global: "LocalInk instructions",
  story: "Story instructions",
  chapter: "Chapter note",
  scene: "Scene note",
  moment: "Moment note",
} as const;

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border border-border bg-card/60 py-0.5 pr-2 pl-2 text-caption";

/**
 * Mirrors what `buildStudioMomentPrompt` includes for a moment: the non-empty
 * instruction layers (style is its own chip), and the Bible entries in
 * present + pinned - excluded that still exist.
 */
export function AiSeesChips({ item }: { item: StudioPlanItemDto }) {
  const { state } = useStudioStore();
  const patchItem = usePatchPlanItem();
  const { entries, globalInstructions, planItems, story } = state;

  const layers = useMemo(
    () =>
      getInstructionStack(
        {
          globalInstructions,
          story: { ...story, style: EMPTY_STUDIO_STYLE },
          planItems,
        },
        item.id,
      ),
    [globalInstructions, item.id, planItems, story],
  );
  const hasStyle = Object.values(story.style).some((value) => value.trim());

  const pinned = new Set(item.contextPinnedEntryIds);
  const included = useMemo(() => {
    const ids = new Set([
      ...item.presentEntryIds,
      ...item.contextPinnedEntryIds,
    ]);
    for (const excluded of item.contextExcludedEntryIds) ids.delete(excluded);
    return entries.filter((entry) => ids.has(entry.id));
  }, [
    entries,
    item.contextExcludedEntryIds,
    item.contextPinnedEntryIds,
    item.presentEntryIds,
  ]);
  const includedIds = new Set(included.map((entry) => entry.id));
  const candidates = entries.filter((entry) => !includedIds.has(entry.id));

  function removeEntry(entryId: string) {
    void patchItem(item.id, (latest) =>
      latest.contextPinnedEntryIds.includes(entryId)
        ? {
            contextPinnedEntryIds: latest.contextPinnedEntryIds.filter(
              (id) => id !== entryId,
            ),
          }
        : {
            contextExcludedEntryIds: latest.contextExcludedEntryIds.includes(
              entryId,
            )
              ? latest.contextExcludedEntryIds
              : [...latest.contextExcludedEntryIds, entryId],
          },
    );
  }

  function pinEntry(entryId: string) {
    // Excluded wins in the prompt, so pinning also lifts an exclusion.
    void patchItem(item.id, (latest) => ({
      contextPinnedEntryIds: latest.contextPinnedEntryIds.includes(entryId)
        ? latest.contextPinnedEntryIds
        : [...latest.contextPinnedEntryIds, entryId],
      contextExcludedEntryIds: latest.contextExcludedEntryIds.filter(
        (id) => id !== entryId,
      ),
    }));
  }

  return (
    <InspectSection title="What the AI sees">
      <div className="flex flex-wrap items-center gap-1">
        {layers.map((layer) => (
          <span
            className={CHIP_CLASS}
            key={`${layer.level}-${layer.itemId ?? "root"}`}
          >
            {LAYER_LABEL[layer.level]}
          </span>
        ))}
        {hasStyle ? <span className={CHIP_CLASS}>Style</span> : null}
        {included.map((entry) => {
          const isPinned = pinned.has(entry.id);
          return (
            <span className={CHIP_CLASS} key={entry.id}>
              {isPinned ? (
                <span aria-label="Pinned" role="img">
                  📌
                </span>
              ) : (
                <span
                  aria-label="Included automatically"
                  className="size-1.5 rounded-full bg-studio-status-written"
                  role="img"
                />
              )}
              {entry.name}
              <button
                aria-label={
                  isPinned
                    ? `Unpin ${entry.name}`
                    : `Stop showing ${entry.name} to the AI`
                }
                className="rounded-full p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => removeEntry(entry.id)}
                type="button"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          );
        })}
        <EntryPicker entries={candidates} label="add" onPick={pinEntry} />
      </div>
    </InspectSection>
  );
}
