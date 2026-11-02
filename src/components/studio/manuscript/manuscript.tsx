"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import {
  useFocusBundleOp,
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import {
  studioChapterAnchorId,
  studioSceneAnchorId,
} from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { DraftBlock } from "./draft-block";
import {
  buildManuscriptLayout,
  chapterNumberWord,
  type ManuscriptBlock,
} from "./manuscript-layout";
import { MomentEditor } from "./moment-editor";
import { UpNext } from "./up-next";
import { useReadingPosition } from "./use-reading-position";
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
      className="mt-24 mb-12 scroll-mt-10 text-center font-content font-normal first:mt-0"
      id={studioChapterAnchorId(chapter.id)}
    >
      <span className="block text-caption text-muted-foreground uppercase tracking-[0.2em]">
        Chapter {chapterNumberWord(number)}
      </span>
      {title ? (
        <span className="mt-2 block text-[1.5rem] leading-9">{title}</span>
      ) : null}
    </h2>
  );
}

/** Marks a moment that has a pending proposed rewrite. */
function ProposedProseMarker({ onReview }: { onReview: () => void }) {
  return (
    <button
      className="mb-1 flex items-center gap-1.5 rounded-full border border-studio-proposed/60 border-dashed px-2 py-0.5 font-sans text-caption text-studio-proposed outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/40"
      contentEditable={false}
      onClick={onReview}
      type="button"
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-studio-proposed"
      />
      Proposed rewrite — review in chat
    </button>
  );
}

function SceneBreak() {
  return (
    <div className="my-8 select-none text-center text-muted-foreground">
      <hr className="sr-only" />
      <span aria-hidden="true">⁂</span>
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
      : { "data-studio-moment": block.moment.id }),
    // The outline scrolls to a scene's first rendered element.
    ...(block.type !== "break" && block.sceneStart
      ? { id: studioSceneAnchorId(block.sceneId) }
      : {}),
  };
}

/**
 * The book view: only what is written. Chapter openers, scene breaks and one
 * seamless editor per written moment, ending with a quiet "Up next" line.
 */
export function Manuscript() {
  const { state, dispatch } = useStudioStore();
  const proseById = useProseByMomentId();
  const loop = useWritingLoop();
  const { pending, proseOpByMomentId } = useBundlePreview();
  const focusBundleOp = useFocusBundleOp();
  const reviewProposedProse = (momentId: string) => {
    const op = proseOpByMomentId.get(momentId);
    if (pending && op) focusBundleOp({ bundleId: pending.id, opId: op.id });
  };
  const storyId = state.story.id;
  const selectedItemId = state.selectedItemId;
  const draft = loop.draft;
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedItemId);
  useEffect(() => {
    selectedRef.current = selectedItemId;
  }, [selectedItemId]);
  // Until the writing loop tracks one draft per moment, pass its single draft.
  const draftByMomentId = useMemo(
    () => new Map(draft ? [[draft.momentId, draft]] : []),
    [draft],
  );

  const layout = useMemo(
    () =>
      buildManuscriptLayout({
        activeMomentId,
        draftByMomentId,
        planItems: state.planItems,
        proseById,
      }),
    [activeMomentId, draftByMomentId, proseById, state.planItems],
  );
  const momentKey = useMemo(
    () =>
      layout.blocks
        .map((block) => (block.type === "moment" ? block.moment.id : ""))
        .join(","),
    [layout.blocks],
  );
  useReadingPosition(containerRef, momentKey);

  const handleFocusMoment = useCallback(
    (momentId: string | null) => {
      if (!momentId) return;
      setActiveMomentId(momentId);
      if (selectedRef.current === momentId) return;
      selectedRef.current = momentId;
      dispatch({ type: "select", itemId: momentId });
    },
    [dispatch],
  );
  const handleBlurMoment = useCallback((momentId: string | null) => {
    setActiveMomentId((current) => (current === momentId ? null : current));
  }, []);

  return (
    <div
      className="mx-auto max-w-[38rem] px-6 pt-16 pb-[40vh] font-content"
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
                key={`moment:${block.moment.id}`}
                {...blockDataProps(block)}
              >
                {proseOpByMomentId.has(block.moment.id) ? (
                  <ProposedProseMarker
                    onReview={() => reviewProposedProse(block.moment.id)}
                  />
                ) : null}
                <MomentEditor
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
        }
        return null;
      })}
      {draft ? null : layout.blocks.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center font-sans text-caption text-muted-foreground">
            Nothing written yet.
            {layout.upNext ? "" : " Add a scene in the outline to begin."}
          </p>
          {layout.upNext ? <UpNext sceneId={layout.upNext.sceneId} /> : null}
        </div>
      ) : (
        <div className="mt-20 flex flex-col items-center gap-4">
          <span
            aria-hidden="true"
            className="select-none text-muted-foreground/60"
          >
            ⁂
          </span>
          {layout.upNext ? <UpNext sceneId={layout.upNext.sceneId} /> : null}
        </div>
      )}
    </div>
  );
}
