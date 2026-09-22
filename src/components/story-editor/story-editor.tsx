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
import { StoryEditorChatPane } from "@/components/story-editor/story-editor-chat-pane";
import { StoryEditorContentPane } from "@/components/story-editor/story-editor-content-pane";
import { StoryEditorContextPane } from "@/components/story-editor/story-editor-context-pane";

type StoryEditorProps = {
  story: StoryEditorData;
};

function toStoryContext(source: StoryContext): StoryContext {
  return {
    characters: source.characters,
    locations: source.locations,
    style: source.style,
    systemInstructions: source.systemInstructions,
    voiceExemplars: source.voiceExemplars,
  };
}

export function StoryEditor({ story }: StoryEditorProps) {
  const [isContextOpen, setIsContextOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chapters, setChapters] = useState(story.chapters);
  const [storyContext, setStoryContext] = useState<StoryContext>(() =>
    toStoryContext(story),
  );
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    // Until the writer chooses an insertion point, continue at the story end.
    story.chapters.at(-1)?.id ?? null,
  );
  const [chapterCreateError, setChapterCreateError] = useState<string | null>(
    null,
  );
  const createChapterAction = useAction(createChapter);
  const focusedChapter = useMemo(
    () =>
      chapters.find((chapter) => chapter.id === activeChapterId) ??
      chapters.at(-1),
    [activeChapterId, chapters],
  );
  const columnStyle = {
    "--story-editor-columns": `${isContextOpen ? "24rem" : "3.5rem"} minmax(0, 1fr) ${
      isChatOpen ? "28rem" : "3.5rem"
    }`,
  } as CSSProperties;

  // Destructured so the effect's captures line up with its dependency list:
  // resyncing on each story field keeps a re-render that did not change the
  // story from clobbering local edits.
  const {
    chapters: storyChapters,
    characters,
    locations,
    style,
    systemInstructions,
    voiceExemplars,
  } = story;

  useEffect(() => {
    setChapters(storyChapters);
    setStoryContext(
      toStoryContext({
        characters,
        locations,
        style,
        systemInstructions,
        voiceExemplars,
      }),
    );
    setActiveChapterId((currentChapterId) =>
      currentChapterId &&
      storyChapters.some((chapter) => chapter.id === currentChapterId)
        ? currentChapterId
        : (storyChapters.at(-1)?.id ?? null),
    );
  }, [
    storyChapters,
    characters,
    locations,
    style,
    systemInstructions,
    voiceExemplars,
  ]);

  const handleStoryContextSaved = useCallback(
    (context: StoryContext & { updatedAt: string }) => {
      setStoryContext(toStoryContext(context));
    },
    [],
  );

  const handleChapterSaved = useCallback((savedChapter: StoryChapterItem) => {
    setChapters((currentChapters) =>
      currentChapters.map((chapter) =>
        chapter.id === savedChapter.id ? savedChapter : chapter,
      ),
    );
  }, []);

  const handleChapterDeleted = useCallback((chapterId: string) => {
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
  }, []);

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
        locations={storyContext.locations}
        onContextSaved={handleStoryContextSaved}
        onToggleOpen={() => setIsContextOpen((isOpen) => !isOpen)}
        story={{
          id: story.id,
          name: story.name,
          description: story.description,
        }}
        style={storyContext.style}
        systemInstructions={storyContext.systemInstructions}
        voiceExemplars={storyContext.voiceExemplars}
      />

      <StoryEditorContentPane
        chapterCreateError={chapterCreateError}
        chapters={chapters}
        characters={storyContext.characters}
        focusedChapterId={focusedChapter?.id ?? null}
        isCreatingChapter={createChapterAction.isPending}
        locations={storyContext.locations}
        onAddChapter={handleAddChapter}
        onChapterDeleted={handleChapterDeleted}
        onChapterFocus={setActiveChapterId}
        onChapterSaved={handleChapterSaved}
        onContextSaved={handleStoryContextSaved}
        story={{
          id: story.id,
          name: story.name,
          description: story.description,
          systemInstructions: storyContext.systemInstructions,
        }}
        style={storyContext.style}
        voiceExemplars={storyContext.voiceExemplars}
      />

      <StoryEditorChatPane
        isOpen={isChatOpen}
        onToggleOpen={() => setIsChatOpen((isOpen) => !isOpen)}
        story={{
          id: story.id,
          name: story.name,
        }}
      />
    </div>
  );
}
