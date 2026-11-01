"use client";

import { useCallback } from "react";

import { Textarea } from "@/components/common/textarea";
import { useAutosaveFields } from "@/components/studio/inspect/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";

import { BibleFieldLabel, BibleHeading, NeverSaysPill } from "./bible-field";
import { useSaveStory } from "./use-save-story";

type Key = "overview" | "theme";

export function OverviewSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const { story } = state;

  const save = useCallback(
    async (changed: Partial<Record<Key, string>>, final: boolean) => {
      const trim = (value: string) => (final ? value.trim() : value);
      const patch: { overview?: string; theme?: string } = {};
      if (changed.overview !== undefined)
        patch.overview = trim(changed.overview);
      if (changed.theme !== undefined) patch.theme = trim(changed.theme);
      return (await saveStory(patch)) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<Key>({
    save,
    serverValues: { overview: story.overview, theme: story.theme },
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
      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel
          hint="What the story is quietly about."
          htmlFor="bible-theme"
          pills={<NeverSaysPill />}
        >
          Theme
        </BibleFieldLabel>
        <Textarea
          className="min-h-20"
          id="bible-theme"
          maxLength={2000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("theme", event.target.value)}
          value={values.theme}
        />
      </div>
    </div>
  );
}
