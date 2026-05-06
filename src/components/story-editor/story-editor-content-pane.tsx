"use client";

import { Plus } from "lucide-react";
import { useCallback, useRef } from "react";

import type {
  StoryChapterIndexSnapshot,
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { Button } from "@/components/common/button";
import { AiProseGenerationWidget } from "@/components/story-editor/ai-prose-generation-widget";
import type { ChapterAiDraftHandle } from "@/components/story-editor/chapter-ai-draft-plugin";
import { ChapterContentEditor } from "@/components/story-editor/chapter-content-editor";

type StoryEditorContentPaneProps = {
  chapterCreateError: string | null;
  chapters: StoryChapterItem[];
  characters: StoryContext["characters"];
  focusedChapterId: string | null;
  isCreatingChapter: boolean;
  onAddChapter: () => void;
  onChapterDeleted: (chapterId: string, updatedAt: string) => void;
  onChapterFocus: (chapterId: string) => void;
  onChapterIndexed: (chapter: StoryChapterIndexSnapshot) => void;
  onChapterSaved: (chapter: StoryChapterItem) => void;
  story: Pick<StoryEditorData, "description" | "id" | "name">;
  style: string;
};

export function StoryEditorContentPane({
  chapterCreateError,
  chapters,
  characters,
  focusedChapterId,
  isCreatingChapter,
  onAddChapter,
  onChapterDeleted,
  onChapterFocus,
  onChapterIndexed,
  onChapterSaved,
  story,
  style,
}: StoryEditorContentPaneProps) {
  const hasChapters = chapters.length > 0;
  const aiDraftHandlesRef = useRef(new Map<string, ChapterAiDraftHandle>());
  const handleRegisterAiDraftHandle = useCallback(
    (chapterId: string, handle: ChapterAiDraftHandle | null) => {
      if (handle) {
        aiDraftHandlesRef.current.set(chapterId, handle);
        return;
      }

      aiDraftHandlesRef.current.delete(chapterId);
    },
    [],
  );
  const getAiDraftHandle = useCallback((chapterId: string) => {
    return aiDraftHandlesRef.current.get(chapterId) ?? null;
  }, []);

  return (
    <section className="relative flex min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto px-page pt-6 pb-28">
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
                  onIndexed={onChapterIndexed}
                  onRegisterAiDraftHandle={handleRegisterAiDraftHandle}
                  onSaved={onChapterSaved}
                  storyId={story.id}
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

      {hasChapters ? (
        <AiProseGenerationWidget
          characters={characters}
          chapters={chapters}
          focusedChapterId={focusedChapterId}
          getAiDraftHandle={getAiDraftHandle}
          story={story}
          style={style}
        />
      ) : null}
    </section>
  );
}
