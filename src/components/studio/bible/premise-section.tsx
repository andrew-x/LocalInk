"use client";

import { useCallback } from "react";

import { Textarea } from "@/components/common/textarea";
import { useAutosaveFields } from "@/components/studio/inspect/use-autosave-fields";
import { useSaveStory } from "@/components/studio/settings/use-save-story";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";

import { BibleFieldLabel, BibleHeading } from "./bible-field";

/**
 * Temporary: the premise editor for the Bible sheet's Overview page. The
 * premise moves into the outline in Task 4; Task 5 deletes this with the sheet.
 */
export function PremiseSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();

  const save = useCallback(
    async (changed: { overview?: string }, final: boolean) => {
      if (changed.overview === undefined) return false;
      const overview = final ? changed.overview.trim() : changed.overview;
      return (await saveStory({ overview })) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<"overview">({
    save,
    serverValues: { overview: state.story.overview },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <BibleHeading>Overview</BibleHeading>
        <p className="text-body text-muted-foreground">
          The premise, in your words. The AI reads this for every moment.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel htmlFor="bible-overview">Premise</BibleFieldLabel>
        <Textarea
          className="min-h-40 font-content"
          id="bible-overview"
          maxLength={20_000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("overview", event.target.value)}
          placeholder="Who is this about, what do they want, what stands in the way?"
          value={values.overview}
        />
      </div>
    </div>
  );
}
