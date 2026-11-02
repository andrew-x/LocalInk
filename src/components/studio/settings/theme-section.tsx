"use client";

import { useCallback } from "react";

import { Textarea } from "@/components/common/textarea";
import {
  BibleFieldLabel,
  BibleHeading,
  NeverSaysPill,
} from "@/components/studio/bible/bible-field";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { useSaveStory } from "./use-save-story";

type Key = "theme";

export function ThemeSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const { story } = state;

  const save = useCallback(
    async (changed: Partial<Record<Key, string>>, final: boolean) => {
      const trim = (value: string) => (final ? value.trim() : value);
      if (changed.theme === undefined) return false;
      return (await saveStory({ theme: trim(changed.theme) })) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<Key>({
    save,
    serverValues: { theme: story.theme },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <BibleHeading>Theme</BibleHeading>
        <p className="text-body text-muted-foreground">
          What the story is quietly about. The AI reads this for every moment.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel
          hint="What the story is quietly about."
          htmlFor="settings-theme"
          pills={<NeverSaysPill />}
        >
          Theme
        </BibleFieldLabel>
        <Textarea
          className="min-h-20"
          id="settings-theme"
          maxLength={2000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("theme", event.target.value)}
          value={values.theme}
        />
      </div>
    </div>
  );
}
