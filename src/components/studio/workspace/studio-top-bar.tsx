"use client";

import {
  ChevronLeft,
  PanelRightClose,
  PanelRightOpen,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { Button } from "@/components/common/button";
import { StorySettingsDialog } from "@/components/studio/settings/story-settings-dialog";

import { useRunStudioAction, useStudioStore } from "./use-studio-store";

export function StudioTopBar() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const { story } = state;
  const [titleDraft, setTitleDraft] = useState(story.title);
  const skipCommit = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const wordCount = useMemo(
    () => state.prose.reduce((sum, p) => sum + p.wordCount, 0),
    [state.prose],
  );
  const chapterProgress = useMemo(() => {
    const byId = new Map(state.planItems.map((item) => [item.id, item]));
    const chapters = state.planItems
      .filter((item) => item.kind === "chapter")
      .sort((a, b) => a.position - b.position);
    let current = state.readingItemId ? byId.get(state.readingItemId) : null;
    // Walk up to the chapter that holds the item in view.
    while (current && current.kind !== "chapter") {
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const index = current
      ? chapters.findIndex((chapter) => chapter.id === current.id)
      : -1;
    return { total: chapters.length, number: index >= 0 ? index + 1 : null };
  }, [state.planItems, state.readingItemId]);

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

      <p className="ml-auto flex shrink-0 items-center gap-3 text-caption text-muted-foreground tabular-nums">
        <span>{wordCount.toLocaleString()} words</span>
        {chapterProgress.total > 0 ? (
          <span>
            Ch {chapterProgress.number ?? ""} of {chapterProgress.total}
          </span>
        ) : null}
      </p>

      <Button
        aria-pressed={state.readMode}
        leftSection={
          state.readMode ? (
            <PanelRightOpen aria-hidden="true" className="size-3.5" />
          ) : (
            <PanelRightClose aria-hidden="true" className="size-3.5" />
          )
        }
        onClick={() =>
          dispatch({ type: "setReadMode", value: !state.readMode })
        }
        size="sm"
        type="button"
        variant="outline"
      >
        {state.readMode ? "Show plan" : "Hide plan"}
      </Button>

      <Button
        leftSection={<Settings aria-hidden="true" className="size-3.5" />}
        onClick={() => setSettingsOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        Story settings
      </Button>
      <StorySettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
    </header>
  );
}
