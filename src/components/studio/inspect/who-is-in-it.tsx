"use client";

import { X } from "lucide-react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { EntryPicker } from "./entry-picker";
import { InspectSection } from "./inspect-section";
import { usePatchPlanItem } from "./use-patch-plan-item";

export function WhoIsInIt({ item }: { item: StudioPlanItemDto }) {
  const { state } = useStudioStore();
  const patchItem = usePatchPlanItem();
  const present = item.presentEntryIds
    .map((id) => state.entries.find((entry) => entry.id === id))
    .filter((entry) => entry !== undefined);
  const candidates = state.entries.filter(
    (entry) => !item.presentEntryIds.includes(entry.id),
  );

  // Read the list at save time so two quick edits both land.
  function change(update: (ids: string[]) => string[]) {
    void patchItem(item.id, (latest) => ({
      presentEntryIds: update(latest.presentEntryIds),
    }));
  }

  return (
    <InspectSection title="Who's in it">
      <div className="flex flex-wrap items-center gap-1">
        {present.map((entry) => (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 py-0.5 pr-1 pl-2 text-label-sm"
            key={entry.id}
          >
            {entry.name}
            <button
              aria-label={`Remove ${entry.name} from this ${item.kind}`}
              className="rounded-full p-0.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() =>
                change((ids) => ids.filter((id) => id !== entry.id))
              }
              type="button"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        {present.length === 0 ? (
          <span className="text-caption text-muted-foreground">
            Nobody yet.
          </span>
        ) : null}
        <EntryPicker
          entries={candidates}
          label="add"
          onPick={(entryId) =>
            change((ids) => (ids.includes(entryId) ? ids : [...ids, entryId]))
          }
        />
      </div>
    </InspectSection>
  );
}
