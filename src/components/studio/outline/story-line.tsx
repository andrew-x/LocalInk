"use client";

import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useCallback, useState } from "react";

import { useSaveStory } from "@/components/studio/settings/use-save-story";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { studioOutlineLineId } from "@/components/studio/workspace/workspace-anchors";
import { cn } from "@/lib/util";

import { PlainText } from "./plain-text";
import { useOutlineEditReporter } from "./use-outline-open";
import { STORY_LINE_KEY, useOutlineView } from "./use-outline-view";

/**
 * The outline's top line: "The story" and the start of the premise. It
 * expands into the premise, edited in place and autosaved.
 */
export function StoryLine() {
  const { state } = useStudioStore();
  const { tabStopId } = useOutlineView();
  const [open, setOpen] = useState(false);
  const overview = state.story.overview;

  function toggle() {
    setOpen((current) => !current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      toggle();
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div>
      <div
        aria-expanded={open}
        aria-level={1}
        className="group/line flex h-7 min-w-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap rounded-md px-2 font-normal text-label-sm outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40"
        data-outline-line={STORY_LINE_KEY}
        id={studioOutlineLineId(STORY_LINE_KEY)}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={tabStopId === STORY_LINE_KEY ? 0 : -1}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground/70 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0 font-medium text-muted-foreground">
          The story
        </span>
        <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground/80">
          {open ? "" : overview || "What is it about?"}
        </span>
      </div>
      {open ? (
        <PremiseEditor
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() =>
              document
                .getElementById(studioOutlineLineId(STORY_LINE_KEY))
                ?.focus(),
            );
          }}
        />
      ) : null}
    </div>
  );
}

function PremiseEditor({ onClose }: { onClose: () => void }) {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const onDirtyChange = useOutlineEditReporter();

  const save = useCallback(
    async (changed: { overview?: string }, final: boolean) => {
      if (changed.overview === undefined) return false;
      const overview = final ? changed.overview.trim() : changed.overview;
      return (await saveStory({ overview })) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<"overview">({
    onDirtyChange,
    save,
    serverValues: { overview: state.story.overview },
  });

  return (
    <div className="pt-0.5 pr-2 pb-2 pl-7">
      <PlainText
        autoFocus
        className="text-muted-foreground focus-visible:text-foreground"
        label="The premise"
        maxLength={20_000}
        onBlur={() => void flush(true)}
        onChange={(event) => setValue("overview", event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Who is this about, what do they want, what stands in the way?"
        value={values.overview}
      />
    </div>
  );
}
