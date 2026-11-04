"use client";

import Link from "next/link";
import { useCallback } from "react";

import { Textarea } from "@/components/common/textarea";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { BibleFieldLabel, BibleHeading } from "./settings-field";
import { type StoryPatch, useSaveStory } from "./use-save-story";

type Key = "instructions";

export function InstructionsStyleSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const { story } = state;

  const save = useCallback(
    async (changed: Partial<Record<Key, string>>, final: boolean) => {
      const trim = (value: string) => (final ? value.trim() : value);
      const patch: StoryPatch = {};
      if (changed.instructions !== undefined)
        patch.instructions = trim(changed.instructions);
      return (await saveStory(patch)) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<Key>({
    save,
    serverValues: {
      instructions: story.instructions,
    },
  });

  const globalText = state.globalInstructions.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BibleHeading>Instructions &amp; Style</BibleHeading>
        <p className="text-body text-muted-foreground">
          The AI reads these in order: LocalInk instructions, then this story,
          then each chapter, scene and moment. The more specific note wins.
        </p>
      </div>

      <details className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
        <summary className="cursor-pointer text-label-sm text-muted-foreground">
          LocalInk instructions (read-only here)
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {globalText ? (
            <p className="whitespace-pre-wrap text-label-sm">{globalText}</p>
          ) : (
            <p className="text-label-sm text-muted-foreground">
              No global instructions set.
            </p>
          )}
          <Link
            className="self-start text-caption text-primary underline-offset-4 hover:underline"
            href="/"
            rel="noreferrer"
            target="_blank"
          >
            edit in LocalInk settings
          </Link>
        </div>
      </details>

      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel htmlFor="bible-instructions">
          Story instructions
        </BibleFieldLabel>
        <Textarea
          className="min-h-32"
          id="bible-instructions"
          maxLength={8000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("instructions", event.target.value)}
          placeholder="Anything the AI should follow for the whole story"
          value={values.instructions}
        />
      </div>
    </div>
  );
}
