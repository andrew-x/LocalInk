"use client";

import { Plus } from "lucide-react";

import type { StoryChapterItem } from "@/actions/stories/_types";
import { Button } from "@/components/common/button";
import { ChapterContentEditor } from "@/components/story-editor/chapter-content-editor";

type StoryEditorContentPaneProps = {
  chapterCreateError: string | null;
  chapters: StoryChapterItem[];
  focusedChapterId: string | null;
  isCreatingChapter: boolean;
  onAddChapter: () => void;
  onChapterDeleted: (chapterId: string, updatedAt: string) => void;
  onChapterFocus: (chapterId: string) => void;
  onChapterSaved: (chapter: StoryChapterItem) => void;
  storyId: string;
};

export function StoryEditorContentPane({
  chapterCreateError,
  chapters,
  focusedChapterId,
  isCreatingChapter,
  onAddChapter,
  onChapterDeleted,
  onChapterFocus,
  onChapterSaved,
  storyId,
}: StoryEditorContentPaneProps) {
  const hasChapters = chapters.length > 0;

  return (
    <section className="flex min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto px-page pt-6 pb-24">
        <div className="mx-auto flex min-h-full w-full max-w-readable flex-col">
          {hasChapters ? (
            <ol className="grid gap-5">
              {chapters.map((chapter) => (
                <ChapterContentEditor
                  chapter={chapter}
                  isActive={focusedChapterId === chapter.id}
                  key={chapter.id}
                  onDeleted={onChapterDeleted}
                  onFocus={onChapterFocus}
                  onSaved={onChapterSaved}
                  storyId={storyId}
                />
              ))}
            </ol>
          ) : (
            <div className="flex min-h-80 flex-1 items-center justify-center rounded-md border border-dashed border-border/70 px-4 text-center font-content text-[1.125rem] leading-8 text-muted-foreground">
              No chapters yet
            </div>
          )}

          <div className="mt-5 grid gap-3">
            <Button
              className={hasChapters ? "justify-self-center" : "w-full"}
              leftSection={<Plus aria-hidden="true" />}
              loading={isCreatingChapter}
              onClick={onAddChapter}
              size={hasChapters ? "sm" : "lg"}
              type="button"
              variant={hasChapters ? "ghost" : "default"}
            >
              Add Chapter
            </Button>
            {chapterCreateError ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
                role="alert"
              >
                {chapterCreateError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
