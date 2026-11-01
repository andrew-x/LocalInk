"use client";

import { useCallback } from "react";

import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { STUDIO_CRAFT_FIELDS } from "@/lib/studio/bible-templates";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { useAutosaveFields } from "./use-autosave-fields";
import { usePatchPlanItem } from "./use-patch-plan-item";

export function CraftDetails({ item }: { item: StudioPlanItemDto }) {
  const patchItem = usePatchPlanItem();
  const fields = STUDIO_CRAFT_FIELDS[item.kind];

  const save = useCallback(
    async (changed: Partial<Record<string, string>>) => {
      // The craft record is saved whole, so merge onto the newest copy.
      const saved = await patchItem(item.id, (latest) => {
        const craft = { ...latest.craft };
        for (const [key, value] of Object.entries(changed)) {
          craft[key] = value ?? "";
        }
        return { craft };
      });
      return saved !== null;
    },
    [item.id, patchItem],
  );

  const { flush, setValue, values } = useAutosaveFields<string>({
    save,
    serverValues: Object.fromEntries(
      fields.map(({ key }) => [key, item.craft[key] ?? ""]),
    ),
  });

  return (
    <details className="border-border/60 border-t pt-3">
      <summary className="cursor-pointer font-semibold text-caption text-muted-foreground uppercase tracking-wide">
        Craft details
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {fields.map(({ key, label }) => (
          <div className="flex flex-col gap-1" key={key}>
            <Label
              className="text-caption text-muted-foreground"
              htmlFor={`craft-${item.id}-${key}`}
            >
              {label}
            </Label>
            <Input
              className="h-8"
              id={`craft-${item.id}-${key}`}
              maxLength={2000}
              onBlur={() => void flush()}
              onChange={(event) => setValue(key, event.target.value)}
              value={values[key] ?? ""}
            />
          </div>
        ))}
      </div>
    </details>
  );
}
