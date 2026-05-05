"use client";

import { useAction } from "next-safe-action/hooks";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { createChapter } from "@/actions/stories/create-chapter";
import { StoryEditorContentPane } from "@/components/story-editor/story-editor-content-pane";
import { StoryEditorContextPane } from "@/components/story-editor/story-editor-context-pane";
import { StoryEditorInspectPane } from "@/components/story-editor/story-editor-inspect-pane";

type StoryEditorProps = {
  story: StoryEditorData;
};

export function StoryEditor({ story }: StoryEditorProps) {
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [isInspectOpen, setIsInspectOpen] = useState(true);
  const [chapters, setChapters] = useState(story.chapters);
  const [storyContext, setStoryContext] = useState<StoryContext>({
    characters: story.characters,
    style: story.style,
  });
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    story.chapters[0]?.id ?? null,
  );
  const [storyUpdatedAt, setStoryUpdatedAt] = useState(story.updatedAt);
  const [chapterCreateError, setChapterCreateError] = useState<string | null>(
    null,
  );
  const createChapterAction = useAction(createChapter);
  const focusedChapter = useMemo(
    () =>
      chapters.find((chapter) => chapter.id === activeChapterId) ?? chapters[0],
    [activeChapterId, chapters],
  );
  const columnStyle = {
    "--story-editor-columns": `${isContextOpen ? "18rem" : "3.5rem"} minmax(0, 1fr) ${
      isInspectOpen ? "19rem" : "3.5rem"
    }`,
  } as CSSProperties;

  useEffect(() => {
    setChapters(story.chapters);
    setStoryContext({
      characters: story.characters,
      style: story.style,
    });
    setStoryUpdatedAt(story.updatedAt);
    setActiveChapterId((currentChapterId) =>
      currentChapterId &&
      story.chapters.some((chapter) => chapter.id === currentChapterId)
        ? currentChapterId
        : (story.chapters[0]?.id ?? null),
    );
  }, [story.chapters, story.characters, story.style, story.updatedAt]);

  const handleStoryContextSaved = useCallback(
    (context: StoryContext & { updatedAt: string }) => {
      setStoryContext({
        characters: context.characters,
        style: context.style,
      });
      setStoryUpdatedAt(context.updatedAt);
    },
    [],
  );

  const handleChapterSaved = useCallback((savedChapter: StoryChapterItem) => {
    setChapters((currentChapters) =>
      currentChapters.map((chapter) =>
        chapter.id === savedChapter.id ? savedChapter : chapter,
      ),
    );
    setStoryUpdatedAt(savedChapter.updatedAt);
  }, []);

  const handleChapterDeleted = useCallback(
    (chapterId: string, updatedAt: string) => {
      setChapters((currentChapters) => {
        const deletedIndex = currentChapters.findIndex(
          (chapter) => chapter.id === chapterId,
        );
        const nextChapters = currentChapters
          .filter((chapter) => chapter.id !== chapterId)
          .map((chapter, index) => ({
            ...chapter,
            position: index + 1,
          }));

        setActiveChapterId((currentChapterId) => {
          if (!nextChapters.length) {
            return null;
          }

          if (
            currentChapterId &&
            currentChapterId !== chapterId &&
            nextChapters.some((chapter) => chapter.id === currentChapterId)
          ) {
            return currentChapterId;
          }

          const nextIndex =
            deletedIndex >= 0
              ? Math.min(deletedIndex, nextChapters.length - 1)
              : 0;

          return nextChapters[nextIndex]?.id ?? null;
        });

        return nextChapters;
      });
      setStoryUpdatedAt(updatedAt);
    },
    [],
  );

  async function handleAddChapter() {
    setChapterCreateError(null);

    const result = await createChapterAction.executeAsync({
      storyId: story.id,
    });

    if (result.data) {
      const newChapter = result.data;

      setChapters((currentChapters) =>
        [...currentChapters, newChapter].sort(
          (firstChapter, secondChapter) =>
            firstChapter.position - secondChapter.position,
        ),
      );
      setActiveChapterId(newChapter.id);
      setStoryUpdatedAt(newChapter.updatedAt);
      requestAnimationFrame(() => {
        document
          .getElementById(`chapter-${newChapter.id}`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      return;
    }

    setChapterCreateError(
      result.validationErrors?.formErrors[0] ??
        result.serverError?.message ??
        "The chapter could not be created.",
    );
  }

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--story-editor-columns)]"
      style={columnStyle}
    >
      <StoryEditorContextPane
        characters={storyContext.characters}
        isOpen={isContextOpen}
        onContextSaved={handleStoryContextSaved}
        onToggleOpen={() => setIsContextOpen((isOpen) => !isOpen)}
        story={{
          id: story.id,
          name: story.name,
          description: story.description,
        }}
        style={storyContext.style}
      />

      <StoryEditorContentPane
        chapterCreateError={chapterCreateError}
        chapters={chapters}
        focusedChapterId={focusedChapter?.id ?? null}
        isCreatingChapter={createChapterAction.isPending}
        onAddChapter={handleAddChapter}
        onChapterDeleted={handleChapterDeleted}
        onChapterFocus={setActiveChapterId}
        onChapterSaved={handleChapterSaved}
        storyId={story.id}
      />

      <StoryEditorInspectPane
        focusedChapter={focusedChapter}
        isOpen={isInspectOpen}
        onToggleOpen={() => setIsInspectOpen((isOpen) => !isOpen)}
        storyUpdatedAt={storyUpdatedAt}
      />
    </div>
  );
}
