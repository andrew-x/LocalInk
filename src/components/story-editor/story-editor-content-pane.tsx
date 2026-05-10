"use client";

import { ArrowDown, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { Button } from "@/components/common/button";
import { AiProseGenerationWidget } from "@/components/story-editor/ai-prose-generation-widget";
import type { ChapterAiDraftHandle } from "@/components/story-editor/chapter-ai-draft-plugin";
import { ChapterContentEditor } from "@/components/story-editor/chapter-content-editor";

const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const DRAFT_FOLLOW_BOTTOM_PADDING_PX = 120;
const USER_SCROLL_UP_THRESHOLD_PX = 2;

type StoryEditorContentPaneProps = {
  chapterCreateError: string | null;
  chapters: StoryChapterItem[];
  characters: StoryContext["characters"];
  focusedChapterId: string | null;
  isCreatingChapter: boolean;
  locations: StoryContext["locations"];
  onAddChapter: () => void;
  onChapterDeleted: (chapterId: string, updatedAt: string) => void;
  onChapterFocus: (chapterId: string) => void;
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
  locations,
  onAddChapter,
  onChapterDeleted,
  onChapterFocus,
  onChapterSaved,
  story,
  style,
}: StoryEditorContentPaneProps) {
  const hasChapters = chapters.length > 0;
  const scrollPaneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const draftFollowFrameRef = useRef<number | null>(null);
  const followedDraftRef = useRef<{
    draftId: string | null;
    isEnabled: boolean;
  }>({
    draftId: null,
    isEnabled: false,
  });
  const lastScrollTopRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const aiDraftHandlesRef = useRef(new Map<string, ChapterAiDraftHandle>());
  const updateScrollToBottomVisibility = useCallback(() => {
    const scrollPane = scrollPaneRef.current;

    if (!scrollPane) {
      setShowScrollToBottom(false);
      return;
    }

    const distanceFromBottom =
      scrollPane.scrollHeight - scrollPane.scrollTop - scrollPane.clientHeight;
    const shouldShow = distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX;

    setShowScrollToBottom((currentValue) =>
      currentValue === shouldShow ? currentValue : shouldShow,
    );
  }, []);
  const handleScrollPaneScroll = useCallback(() => {
    const scrollPane = scrollPaneRef.current;

    if (scrollPane) {
      const didScrollUp =
        scrollPane.scrollTop <
        lastScrollTopRef.current - USER_SCROLL_UP_THRESHOLD_PX;

      if (didScrollUp) {
        followedDraftRef.current.isEnabled = false;
      }

      lastScrollTopRef.current = scrollPane.scrollTop;
    }

    updateScrollToBottomVisibility();
  }, [updateScrollToBottomVisibility]);
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
  const handleScrollToBottom = useCallback(() => {
    const scrollPane = scrollPaneRef.current;

    if (!scrollPane) {
      return;
    }

    scrollPane.scrollTo({
      top: scrollPane.scrollHeight,
      behavior: "smooth",
    });
  }, []);
  const scrollDraftIntoView = useCallback(
    (draftId: string) => {
      const scrollPane = scrollPaneRef.current;

      if (!scrollPane) {
        return;
      }

      const draftElement = scrollPane.querySelector<HTMLElement>(
        `[data-ai-draft-id="${draftId}"]`,
      );

      if (!draftElement) {
        return;
      }

      const scrollPaneRect = scrollPane.getBoundingClientRect();
      const draftRect = draftElement.getBoundingClientRect();
      const bottomPadding = Math.min(
        DRAFT_FOLLOW_BOTTOM_PADDING_PX,
        scrollPane.clientHeight / 2,
      );
      const visibleBottom = scrollPaneRect.bottom - bottomPadding;
      const distanceBelowViewport = Math.ceil(draftRect.bottom - visibleBottom);

      if (distanceBelowViewport <= 0) {
        return;
      }

      const maxScrollTop = scrollPane.scrollHeight - scrollPane.clientHeight;
      const nextScrollTop = Math.min(
        scrollPane.scrollTop + distanceBelowViewport,
        maxScrollTop,
      );

      if (nextScrollTop <= scrollPane.scrollTop) {
        return;
      }

      scrollPane.scrollTo({
        top: nextScrollTop,
        behavior: "auto",
      });
      lastScrollTopRef.current = nextScrollTop;
      updateScrollToBottomVisibility();
    },
    [updateScrollToBottomVisibility],
  );
  const handleDraftStreamUpdate = useCallback(
    (draftId: string, options?: { resetFollow?: boolean }) => {
      if (
        options?.resetFollow ||
        followedDraftRef.current.draftId !== draftId
      ) {
        followedDraftRef.current = {
          draftId,
          isEnabled: true,
        };
      }

      if (
        !followedDraftRef.current.isEnabled ||
        followedDraftRef.current.draftId !== draftId
      ) {
        return;
      }

      if (draftFollowFrameRef.current !== null) {
        cancelAnimationFrame(draftFollowFrameRef.current);
      }

      draftFollowFrameRef.current = requestAnimationFrame(() => {
        draftFollowFrameRef.current = null;

        if (
          followedDraftRef.current.isEnabled &&
          followedDraftRef.current.draftId === draftId
        ) {
          scrollDraftIntoView(draftId);
        }
      });
    },
    [scrollDraftIntoView],
  );

  useEffect(() => {
    const scrollPane = scrollPaneRef.current;
    const content = contentRef.current;

    if (!scrollPane) {
      setShowScrollToBottom(false);
      return;
    }

    lastScrollTopRef.current = scrollPane.scrollTop;
    updateScrollToBottomVisibility();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollToBottomVisibility();
    });

    resizeObserver.observe(scrollPane);

    if (content) {
      resizeObserver.observe(content);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateScrollToBottomVisibility]);

  useEffect(
    () => () => {
      if (draftFollowFrameRef.current !== null) {
        cancelAnimationFrame(draftFollowFrameRef.current);
      }
    },
    [],
  );

  return (
    <section className="relative flex min-h-0 flex-col bg-background">
      <div
        className="min-h-0 flex-1 overflow-auto px-page pt-6 pb-28"
        onScroll={handleScrollPaneScroll}
        ref={scrollPaneRef}
      >
        <div
          className="mx-auto flex min-h-full w-full max-w-readable flex-col"
          ref={contentRef}
        >
          {hasChapters ? (
            <ol className="grid gap-5">
              {chapters.map((chapter) => (
                <ChapterContentEditor
                  chapter={chapter}
                  isActive={focusedChapterId === chapter.id}
                  key={chapter.id}
                  onDeleted={onChapterDeleted}
                  onFocus={onChapterFocus}
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

      {showScrollToBottom ? (
        <div className="pointer-events-none absolute right-4 bottom-4 z-40">
          <Button
            aria-label="Scroll to bottom"
            className="pointer-events-auto size-10 rounded-full border-border/80 bg-card/95 text-foreground shadow-lg backdrop-blur hover:bg-muted"
            onClick={handleScrollToBottom}
            size="icon"
            tooltip="Scroll to bottom"
            tooltipSide="left"
            type="button"
            variant="outline"
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {hasChapters ? (
        <AiProseGenerationWidget
          characters={characters}
          chapters={chapters}
          focusedChapterId={focusedChapterId}
          getAiDraftHandle={getAiDraftHandle}
          locations={locations}
          onDraftStreamUpdate={handleDraftStreamUpdate}
          story={story}
          style={style}
        />
      ) : null}
    </section>
  );
}
