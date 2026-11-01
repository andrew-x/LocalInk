"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { studioChapterAnchorId } from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import {
  ContinueLine,
  continuePlaceholder,
  continueTargetTitle,
  useContinueEditor,
} from "./continue-editor";
import { DraftBlock } from "./draft-block";
import {
  buildManuscriptLayout,
  chapterNumberWord,
  type ManuscriptBlock,
} from "./manuscript-layout";
import { MomentEditor } from "./moment-editor";
import { useWritingLoop } from "./use-writing-loop";

function ChapterHeading({
  chapter,
  number,
}: {
  chapter: StudioPlanItemDto;
  number: number;
}) {
  const title = chapter.title.trim();
  return (
    <h2
      className="mt-20 mb-10 scroll-mt-10 text-center font-content font-normal first:mt-0"
      id={studioChapterAnchorId(chapter.id)}
    >
      <span className="block text-[1.375rem] leading-8 tracking-wide">
        {chapterNumberWord(number)}
      </span>
      {title ? (
        <span className="block text-[1.125rem] text-foreground/80 italic leading-8">
          {title}
        </span>
      ) : null}
    </h2>
  );
}

function SceneBreak() {
  return (
    <div className="my-6 select-none text-center text-muted-foreground tracking-[0.6em]">
      <hr className="sr-only" />
      <span aria-hidden="true">* * *</span>
    </div>
  );
}

function blockDataProps(block: ManuscriptBlock) {
  if (block.type === "chapter") return {};
  return {
    "data-studio-chapter": block.chapterId,
    "data-studio-scene": block.sceneId,
    ...(block.type === "break"
      ? {}
      : block.type === "continue"
        ? {
            "data-studio-moment":
              block.target.kind === "moment"
                ? block.target.moment.id
                : undefined,
          }
        : { "data-studio-moment": block.moment.id }),
  };
}

/**
 * The book view: chapter headings, scene breaks and one seamless editor per
 * written moment, with a single continue area after the last written prose.
 */
export function Manuscript() {
  const { state, dispatch } = useStudioStore();
  const proseById = useProseByMomentId();
  const loop = useWritingLoop();
  const storyId = state.story.id;
  const selectedItemId = state.selectedItemId;
  const draft = loop.draft;
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedItemId);
  const selectedHereRef = useRef(false);

  const layout = useMemo(
    () =>
      buildManuscriptLayout({
        activeMomentId,
        draftMomentId: draft?.momentId ?? null,
        planItems: state.planItems,
        proseById,
      }),
    [activeMomentId, draft?.momentId, proseById, state.planItems],
  );
  const { continueKey, createMoment, keyFor } = useContinueEditor(
    layout.target,
  );

  const handleFocusMoment = useCallback(
    (momentId: string | null) => {
      if (!momentId) return;
      setActiveMomentId(momentId);
      if (selectedRef.current === momentId) return;
      // A click in the prose selects its moment without scrolling to it.
      selectedHereRef.current = true;
      selectedRef.current = momentId;
      dispatch({ type: "select", itemId: momentId });
    },
    [dispatch],
  );
  const handleBlurMoment = useCallback((momentId: string | null) => {
    setActiveMomentId((current) => (current === momentId ? null : current));
  }, []);

  // A tree (or arc strip) selection scrolls its first moment into view.
  useEffect(() => {
    selectedRef.current = selectedItemId;
    if (selectedHereRef.current) {
      selectedHereRef.current = false;
      return;
    }
    if (!selectedItemId) return;
    const escaped = CSS.escape(selectedItemId);
    const element =
      document.getElementById(studioChapterAnchorId(selectedItemId)) ??
      containerRef.current?.querySelector(
        `[data-studio-moment="${escaped}"], [data-studio-scene="${escaped}"]`,
      );
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedItemId]);

  const isHighlighted = (block: ManuscriptBlock) =>
    selectedItemId !== null &&
    block.type === "moment" &&
    (block.moment.id === selectedItemId ||
      block.sceneId === selectedItemId ||
      block.chapterId === selectedItemId);

  return (
    <div
      className="mx-auto max-w-[70ch] px-8 pt-12 pb-[40vh] font-content"
      ref={containerRef}
    >
      {layout.blocks.map((block) => {
        switch (block.type) {
          case "chapter":
            return (
              <ChapterHeading
                chapter={block.chapter}
                key={`chapter:${block.chapter.id}`}
                number={block.number}
              />
            );
          case "break":
            return <SceneBreak key={`break:${block.sceneId}`} />;
          case "moment":
            return (
              <div
                className="scroll-mt-24"
                key={keyFor(block.moment.id)}
                {...blockDataProps(block)}
              >
                <MomentEditor
                  isHighlighted={isHighlighted(block)}
                  isSceneStart={block.sceneStart}
                  momentId={block.moment.id}
                  onBlurMoment={handleBlurMoment}
                  onFocusMoment={handleFocusMoment}
                  prose={proseById.get(block.moment.id)}
                  storyId={storyId}
                  title={block.moment.title}
                />
              </div>
            );
          case "draft":
            return draft ? (
              <div
                className="scroll-mt-24"
                key={`draft:${block.moment.id}`}
                {...blockDataProps(block)}
              >
                <DraftBlock
                  draft={draft}
                  isSceneStart={block.sceneStart}
                  replacesProse={block.replacesProse}
                />
              </div>
            ) : null;
          case "continue": {
            const { target } = block;
            const momentId = target.kind === "moment" ? target.moment.id : null;
            return (
              <div
                className="scroll-mt-24"
                key={continueKey}
                {...blockDataProps(block)}
              >
                <MomentEditor
                  continueLine={<ContinueLine target={target} />}
                  createMoment={momentId ? undefined : createMoment}
                  isHighlighted={false}
                  isSceneStart={block.sceneStart}
                  momentId={momentId}
                  onBlurMoment={handleBlurMoment}
                  onFocusMoment={handleFocusMoment}
                  placeholder={continuePlaceholder(target)}
                  prose={momentId ? proseById.get(momentId) : undefined}
                  storyId={storyId}
                  title={continueTargetTitle(target)}
                />
              </div>
            );
          }
        }
        return null;
      })}
      {layout.sceneCount === 0 ? (
        <p className="mt-10 text-center font-sans text-caption text-muted-foreground">
          {layout.chapterCount === 0
            ? "Add a chapter in the plan to start writing."
            : "Add a scene to a chapter, or flesh one out, to start writing."}
        </p>
      ) : null}
    </div>
  );
}
