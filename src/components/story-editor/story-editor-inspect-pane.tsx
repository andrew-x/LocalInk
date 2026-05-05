"use client";

import { FileText } from "lucide-react";

import type { StoryChapterItem } from "@/actions/stories/_types";
import { StoryEditorPaneHeader } from "@/components/story-editor/story-editor-pane-header";
import day from "@/lib/dayjs";

type StoryEditorInspectPaneProps = {
  focusedChapter: StoryChapterItem | undefined;
  isOpen: boolean;
  onToggleOpen: () => void;
  storyUpdatedAt: string;
};

export function StoryEditorInspectPane({
  focusedChapter,
  isOpen,
  onToggleOpen,
  storyUpdatedAt,
}: StoryEditorInspectPaneProps) {
  const updatedAt = formatTimestamp(storyUpdatedAt);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border/80 border-t bg-sidebar/70 lg:border-t-0 lg:border-l">
      <StoryEditorPaneHeader
        isOpen={isOpen}
        label="Inspect"
        onToggle={onToggleOpen}
        side="right"
      />

      {isOpen ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <section className="rounded-md border border-border/70 bg-card/45 p-3">
            <h2 className="flex items-center gap-2 text-label">
              <FileText aria-hidden="true" className="size-3.5" />
              Selection
            </h2>
            <dl className="mt-3 grid gap-3 text-body">
              <div>
                <dt className="text-caption text-muted-foreground">
                  Story updated
                </dt>
                <dd className="mt-1">{updatedAt}</dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">
                  Active chapter
                </dt>
                <dd className="mt-1">
                  {focusedChapter?.name ?? "No chapter selected"}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted-foreground">Summary</dt>
                <dd className="mt-1 text-muted-foreground">
                  {focusedChapter?.summary || "No summary"}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function formatTimestamp(value: string) {
  const date = day(value);

  if (!date.isValid()) {
    return "recently";
  }

  return date.format("lll");
}
