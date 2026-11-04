"use client";

import { useCallback } from "react";

import { Textarea } from "@/components/common/textarea";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { STUDIO_STRUCTURE_TEMPLATES } from "@/lib/studio/bible-templates";
import { cn } from "@/lib/util";
import { BibleFieldLabel, BibleHeading } from "./settings-field";
import { useSaveStory } from "./use-save-story";

export function StructureSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const { story } = state;

  const save = useCallback(
    async (changed: { notes?: string }, final: boolean) => {
      if (changed.notes === undefined) return false;
      const notes = final ? changed.notes.trim() : changed.notes;
      return (await saveStory({ structureNotes: notes })) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<"notes">({
    save,
    serverValues: { notes: story.structureNotes },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <BibleHeading>Structure</BibleHeading>
        <p className="text-body text-muted-foreground">
          The shape the AI plans toward. Changing it does not rewrite your plan.
        </p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Structure template</legend>
        {STUDIO_STRUCTURE_TEMPLATES.map((template) => {
          const selected = story.structureTemplate === template.id;
          return (
            <label
              className={cn(
                "flex cursor-pointer gap-3 rounded-md border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
                selected
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/70 bg-card/40 hover:border-ring/50",
              )}
              key={template.id}
            >
              <input
                checked={selected}
                className="mt-1 accent-primary"
                name="bible-structure-template"
                onChange={() =>
                  void saveStory({ structureTemplate: template.id })
                }
                type="radio"
                value={template.id}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium text-label">{template.label}</span>
                <span className="text-label-sm text-muted-foreground">
                  {template.guidance}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel htmlFor="bible-structure-notes">
          Structure notes
        </BibleFieldLabel>
        <Textarea
          className="min-h-28"
          id="bible-structure-notes"
          maxLength={8000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("notes", event.target.value)}
          placeholder="Beats you already know, an ending you want, things to skip"
          value={values.notes}
        />
      </div>
    </div>
  );
}
