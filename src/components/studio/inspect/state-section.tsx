"use client";

import { useMemo } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { normalizeAspect } from "@/lib/studio/aspects";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { computeStateGoingIn } from "@/lib/studio/state";

import {
  chapterNumberOf,
  chapterNumbers,
  entryNameMap,
} from "./inspect-labels";
import { InspectSection } from "./inspect-section";

export function StateSection({ item }: { item: StudioPlanItemDto }) {
  const { state } = useStudioStore();
  const { changes, entries, planItems } = state;

  const lines = useMemo(() => {
    const states = computeStateGoingIn(
      { entries, changes, planItems },
      item.id,
    );
    const numbers = chapterNumbers(planItems);
    const names = entryNameMap(entries);
    return item.presentEntryIds.flatMap((entryId) => {
      const entryState = states.get(entryId);
      if (!entryState) return [];
      return [
        {
          entryId,
          name: entryState.entry.name,
          aspects: entryState.aspects.map((aspect) => {
            const last = aspect.values[aspect.values.length - 1];
            const since = chapterNumberOf(planItems, numbers, last.planItemId);
            const about = aspect.aboutEntryId
              ? ` (about ${names.get(aspect.aboutEntryId) ?? "unknown entry"})`
              : "";
            return {
              key: `${normalizeAspect(aspect.aspect)}:${aspect.aboutEntryId ?? ""}`,
              label: `${aspect.aspect}${about}`,
              value: aspect.values.map((v) => v.value).join(" · "),
              since: since === null ? null : `since Ch ${since}`,
            };
          }),
        },
      ];
    });
  }, [changes, entries, item.id, item.presentEntryIds, planItems]);

  return (
    <InspectSection title="State going in">
      {lines.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          Add who is in this {item.kind} to see where they stand.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {lines.map((line) => (
            <div className="text-label-sm" key={line.entryId}>
              <b className="font-semibold">{line.name}</b>
              {line.aspects.length === 0 ? (
                <span className="text-muted-foreground">
                  {" "}
                  nothing recorded yet
                </span>
              ) : (
                <ul className="mt-0.5 flex flex-col gap-0.5 pl-3 font-normal text-muted-foreground">
                  {line.aspects.map((aspect) => (
                    <li key={aspect.key}>
                      <span className="text-foreground">{aspect.label}</span>{" "}
                      {aspect.value}
                      {aspect.since ? (
                        <span className="text-caption"> ({aspect.since})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </InspectSection>
  );
}
