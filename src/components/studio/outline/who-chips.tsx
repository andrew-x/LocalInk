"use client";

import { X } from "lucide-react";

import { EntryPicker } from "@/components/studio/shared/entry-picker";
import { usePatchPlanItem } from "@/components/studio/shared/use-patch-plan-item";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

/** Who's in the scene, as small chips: × removes, + adds. The AI fills them too. */
export function WhoChips({ scene }: { scene: StudioPlanItemDto }) {
  const { state } = useStudioStore();
  const patchItem = usePatchPlanItem();
  const present = scene.presentEntryIds
    .map((id) => state.entries.find((entry) => entry.id === id))
    .filter((entry) => entry !== undefined);
  const candidates = state.entries.filter(
    (entry) => !scene.presentEntryIds.includes(entry.id),
  );

  // Read the list at save time so two quick edits both land.
  function change(update: (ids: string[]) => string[]) {
    void patchItem(scene.id, (latest) => ({
      presentEntryIds: update(latest.presentEntryIds),
    }));
  }

  return (
    <ul aria-label="Who's in it" className="flex flex-wrap items-center gap-1">
      {present.map((entry) => (
        <li
          className="inline-flex items-center gap-0.5 rounded-full bg-muted py-px pr-0.5 pl-2 text-caption text-muted-foreground"
          key={entry.id}
        >
          {entry.name}
          <button
            aria-label={`Remove ${entry.name} from this scene`}
            className="rounded-full p-0.5 outline-none hover:bg-background/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => change((ids) => ids.filter((id) => id !== entry.id))}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
      <li>
        <EntryPicker
          entries={candidates}
          label={present.length === 0 ? "Who's in it" : "Add"}
          onPick={(entryId) =>
            change((ids) => (ids.includes(entryId) ? ids : [...ids, entryId]))
          }
        />
      </li>
    </ul>
  );
}
