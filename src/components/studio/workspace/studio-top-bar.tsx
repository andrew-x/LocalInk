"use client";

import { BookOpen, ChevronLeft, Maximize2, Minimize2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { Button } from "@/components/common/button";
import {
  STORY_GENERATION_MODELS,
  storyGenerationModelSchema,
} from "@/lib/story-generation-models";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

export function StudioTopBar() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const { story } = state;
  const [titleDraft, setTitleDraft] = useState(story.title);
  const skipCommit = useRef(false);
  const [isSavingModel, setIsSavingModel] = useState(false);

  useEffect(() => {
    setTitleDraft(story.title);
  }, [story.title]);

  async function commitTitle() {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const next = titleDraft.trim();
    if (!next || next === story.title) {
      setTitleDraft(story.title);
      return;
    }
    const updated = await run(
      updateStudioStory({ storyId: story.id, patch: { title: next } }),
      "The title could not be saved.",
    );
    if (updated) dispatch({ type: "merge", story: updated });
    else setTitleDraft(story.title);
  }

  async function changeModel(value: string) {
    const parsed = storyGenerationModelSchema.safeParse(value);
    if (!parsed.success || parsed.data === story.proseModel) return;
    setIsSavingModel(true);
    try {
      const updated = await run(
        updateStudioStory({
          storyId: story.id,
          patch: { proseModel: parsed.data },
        }),
        "The prose model could not be saved.",
      );
      if (updated) dispatch({ type: "merge", story: updated });
    } finally {
      setIsSavingModel(false);
    }
  }

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-3 border-border/80 border-b bg-background/95 px-3 py-1.5">
      <Button
        aria-label="Back to Studio stories"
        asChild
        className="size-7 shrink-0"
        size="icon"
        tooltip="All stories"
        tooltipSide="bottom"
        variant="ghost"
      >
        <Link href="/studio">
          <ChevronLeft aria-hidden="true" className="size-3.5" />
        </Link>
      </Button>

      <input
        aria-label="Story title"
        className="w-48 min-w-0 shrink rounded-md border border-transparent bg-transparent px-2 py-1 font-serif text-heading outline-none transition-colors hover:border-border focus-visible:border-ring focus-visible:bg-card"
        maxLength={120}
        onBlur={() => void commitTitle()}
        onChange={(event) => setTitleDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            skipCommit.current = true;
            setTitleDraft(story.title);
            event.currentTarget.blur();
          }
        }}
        value={titleDraft}
      />

      <Button
        leftSection={<BookOpen aria-hidden="true" className="size-3.5" />}
        onClick={() => dispatch({ type: "openBible", section: "overview" })}
        size="sm"
        type="button"
        variant="outline"
      >
        Bible
      </Button>

      <label className="sr-only" htmlFor="studio-prose-model">
        Prose model
      </label>
      <select
        className="h-8 max-w-44 min-w-0 rounded-md border border-input bg-card/80 px-2 text-caption shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50"
        disabled={isSavingModel}
        id="studio-prose-model"
        onChange={(event) => void changeModel(event.target.value)}
        value={story.proseModel}
      >
        {STORY_GENERATION_MODELS.map((model) => (
          <option key={model.value} value={model.value}>
            {model.label}
          </option>
        ))}
      </select>

      <Button
        aria-pressed={state.readMode}
        leftSection={
          state.readMode ? (
            <Minimize2 aria-hidden="true" className="size-3.5" />
          ) : (
            <Maximize2 aria-hidden="true" className="size-3.5" />
          )
        }
        onClick={() =>
          dispatch({ type: "setReadMode", value: !state.readMode })
        }
        size="sm"
        type="button"
        variant={state.readMode ? "default" : "outline"}
      >
        Read
      </Button>
    </header>
  );
}
