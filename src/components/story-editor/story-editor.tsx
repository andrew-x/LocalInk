"use client";

import { useAction } from "next-safe-action/hooks";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { createChapter } from "@/actions/stories/create-chapter";
import { getManuscriptProposal } from "@/actions/story-chats/get-manuscript-proposal";
import { resolveManuscriptProposal } from "@/actions/story-chats/resolve-manuscript-proposal";
import {
  type ChapterManuscriptController,
  ManuscriptResolutionError,
} from "@/components/story-editor/chapter-manuscript-controller";
import { StoryEditorChatPane } from "@/components/story-editor/story-editor-chat-pane";
import { StoryEditorContentPane } from "@/components/story-editor/story-editor-content-pane";
import { StoryEditorContextPane } from "@/components/story-editor/story-editor-context-pane";
import type {
  ManuscriptProposal,
  ManuscriptProposalDecision,
  ManuscriptSnapshot,
} from "@/lib/story-manuscript-contract";

type StoryEditorProps = {
  story: StoryEditorData;
};

function toStoryContext(source: StoryContext): StoryContext {
  return {
    characters: source.characters,
    backstory: source.backstory,
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
  const chapterControllers = useRef(
    new Map<string, ChapterManuscriptController>(),
  );
  const resolutionPending = useRef(false);
  const handleRegisterManuscriptController = useCallback(
    (chapterId: string, controller: ChapterManuscriptController | null) => {
      if (controller) chapterControllers.current.set(chapterId, controller);
      else chapterControllers.current.delete(chapterId);
    },
    [],
  );
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
    backstory,
    locations,
    style,
    systemInstructions,
    voiceExemplars,
  } = story;

  useEffect(() => {
    // Mounted editors own their acknowledged revision and live writing. A
    // delayed route refresh must not silently substitute a different baseline.
    setChapters((current) => {
      const currentById = new Map(
        current.map((chapter) => [chapter.id, chapter]),
      );
      const incoming = storyChapters.map((chapter) =>
        chapterControllers.current.has(chapter.id)
          ? (currentById.get(chapter.id) ?? chapter)
          : chapter,
      );
      for (const chapter of current) {
        if (
          !incoming.some((item) => item.id === chapter.id) &&
          chapterControllers.current.get(chapter.id)?.isDirty()
        )
          incoming.push(chapter);
      }
      return incoming;
    });
    setActiveChapterId((currentChapterId) =>
      currentChapterId &&
      storyChapters.some((chapter) => chapter.id === currentChapterId)
        ? currentChapterId
        : (storyChapters.at(-1)?.id ?? null),
    );
  }, [storyChapters]);

  useEffect(() => {
    setStoryContext(
      toStoryContext({
        characters,
        backstory,
        locations,
        style,
        systemInstructions,
        voiceExemplars,
      }),
    );
  }, [
    characters,
    backstory,
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

  const handleChapterSaved = useCallback(
    (savedChapter: StoryChapterItem, source?: "title" | "content") => {
      setChapters((currentChapters) =>
        currentChapters.map((chapter) => {
          if (chapter.id !== savedChapter.id) return chapter;
          if (source === "title")
            return { ...chapter, name: savedChapter.name };
          if (savedChapter.contentRevision < chapter.contentRevision)
            return chapter;
          return source === "content"
            ? { ...savedChapter, name: chapter.name }
            : savedChapter;
        }),
      );
    },
    [],
  );

  const getManuscriptSnapshot = useCallback((): ManuscriptSnapshot => {
    let selection: ManuscriptSnapshot["selection"] = null;
    const snapshots = chapters.map((chapter) => {
      const live = chapterControllers.current.get(chapter.id)?.snapshot();
      if (chapter.id === activeChapterId && live?.selection)
        selection = { chapterId: chapter.id, text: live.selection };
      return {
        id: chapter.id,
        content: live?.content ?? chapter.content,
        contentRevision: live?.contentRevision ?? chapter.contentRevision,
      };
    });
    return {
      chapters: snapshots,
      focusedChapterId: activeChapterId,
      selection,
    };
  }, [activeChapterId, chapters]);

  const handleResolveProposal = useCallback(
    async (
      proposal: ManuscriptProposal,
      decision: ManuscriptProposalDecision,
    ): Promise<ManuscriptProposal> => {
      if (resolutionPending.current)
        throw new ManuscriptResolutionError(
          "Wait for the current manuscript edit to finish.",
        );
      resolutionPending.current = true;
      const frozen: ChapterManuscriptController[] = [];
      let safeToRelease = true;
      try {
        if (decision !== "deny") {
          // No await until every affected editor is frozen.
          for (const target of proposal.chapters) {
            const controller = chapterControllers.current.get(target.chapterId);
            if (!controller)
              throw new ManuscriptResolutionError(
                "A chapter is no longer available. Reload the story before reviewing this edit.",
              );
            controller.freeze();
            frozen.push(controller);
          }
          const flushes = await Promise.allSettled(
            frozen.map((controller) => controller.flush()),
          );
          const failedFlush = flushes.find(
            (flush) => flush.status === "rejected",
          );
          if (failedFlush?.status === "rejected") throw failedFlush.reason;
          for (const [index, controller] of frozen.entries()) {
            const target = proposal.chapters[index];
            const expected =
              decision === "approve" ? target.before : target.after;
            if (controller.snapshot().content !== expected)
              throw new ManuscriptResolutionError(
                "The manuscript has changed since this proposal. Your writing is preserved; ask chat for a new edit.",
              );
            controller.validateImport(
              decision === "approve" ? target.after : target.before,
            );
          }
        }
        const input = {
          storyId: story.id,
          proposalId: proposal.id,
          decision,
          expectedRevisions: frozen.map((controller) => {
            const snapshot = controller.snapshot();
            return {
              chapterId: snapshot.id,
              contentRevision: snapshot.contentRevision,
            };
          }),
        };
        const intendedStatus =
          decision === "approve"
            ? "accepted"
            : decision === "deny"
              ? "rejected"
              : "undone";
        let resolved:
          | Awaited<ReturnType<typeof getManuscriptProposal>>
          | undefined;
        let response:
          | Awaited<ReturnType<typeof resolveManuscriptProposal>>
          | undefined;
        try {
          response = await resolveManuscriptProposal(input);
        } catch {
          response = undefined;
        }
        if (response?.data) resolved = response.data;
        else if (response?.serverError || response?.validationErrors) {
          throw new ManuscriptResolutionError(
            response.serverError?.message ??
              "The manuscript edit could not be applied. Reload and review the proposal again.",
          );
        } else {
          // The write may have committed even if transport failed. Keep old
          // editor content frozen until the same idempotent operation is settled.
          safeToRelease = false;
          try {
            const retry = await resolveManuscriptProposal(input);
            if (retry?.data) resolved = retry.data;
          } catch {
            // A second lost response still allows a read to recover the write.
          }
          if (!resolved) {
            try {
              const recovery = await getManuscriptProposal({
                storyId: story.id,
                proposalId: proposal.id,
              });
              if (recovery.proposal.status === intendedStatus)
                resolved = recovery;
            } catch {
              // Preserve the lock until saved state can be recovered by reload.
            }
          }
          if (!resolved)
            throw new ManuscriptResolutionError(
              "The edit’s saved state could not be confirmed. Affected chapters remain paused. Reload the story to recover saved writing.",
            );
        }
        if (resolved.proposal.status !== intendedStatus)
          throw new ManuscriptResolutionError(
            "This proposal has already been resolved differently. Reload the story to review its current state.",
          );
        if (decision !== "deny") {
          safeToRelease = false;
          const returned = new Map(
            resolved.chapters.map((chapter) => [chapter.id, chapter]),
          );
          for (const [index, controller] of frozen.entries()) {
            const chapter = returned.get(proposal.chapters[index].chapterId);
            if (!chapter)
              throw new ManuscriptResolutionError(
                "The saved chapter could not be recovered. Reload the story to continue.",
              );
            controller.validateImport(chapter.content);
          }
          for (const [index, controller] of frozen.entries()) {
            const chapter = returned.get(proposal.chapters[index].chapterId);
            if (chapter) {
              controller.importCommitted(chapter);
              handleChapterSaved(chapter, "content");
            }
          }
        }
        safeToRelease = true;
        return resolved.proposal;
      } catch (error) {
        if (error instanceof ManuscriptResolutionError) throw error;
        throw new ManuscriptResolutionError(
          safeToRelease
            ? "The manuscript edit could not be applied. Your local writing is preserved."
            : "The saved manuscript could not be loaded. Affected chapters remain paused; reload the story to recover saved writing.",
        );
      } finally {
        if (safeToRelease) {
          for (const controller of frozen) controller.release();
          resolutionPending.current = false;
        }
      }
    },
    [handleChapterSaved, story.id],
  );

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
        backstory={storyContext.backstory}
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
        onRegisterManuscriptController={handleRegisterManuscriptController}
        onContextSaved={handleStoryContextSaved}
        story={{
          id: story.id,
          name: story.name,
          description: story.description,
          systemInstructions: storyContext.systemInstructions,
          backstory: storyContext.backstory,
        }}
        style={storyContext.style}
        voiceExemplars={storyContext.voiceExemplars}
      />

      <StoryEditorChatPane
        getManuscriptSnapshot={getManuscriptSnapshot}
        onResolveProposal={handleResolveProposal}
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
