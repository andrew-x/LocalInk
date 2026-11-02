"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { suggestionAnchorId } from "@/components/studio/ai-box/suggestion-controls";
import { useBundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import {
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import {
  studioChapterAnchorId,
  studioSceneAnchorId,
} from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { ChatDraftBar, chatDraftsOf } from "./chat-draft-bar";
import {
  buildManuscriptLayout,
  chapterNumberWord,
  type ManuscriptBlock,
} from "./manuscript-layout";
import { MomentEditor } from "./moment-editor";
import { DraftBar, DraftBeat, SceneDraftGroup } from "./scene-draft";
import {
  isSceneDraftKeepable,
  isSceneDraftRunning,
  type SceneDraft,
} from "./scene-draft-model";
import { UpNext } from "./up-next";
import { useReadingPosition } from "./use-reading-position";
import { useWritingLoop } from "./use-writing-loop";
import { WritingStatus } from "./writing-status";

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
    ...(block.type === "moment"
      ? { "data-studio-moment": block.moment.id }
      : {}),
    // The outline scrolls to a scene's first rendered element.
    ...(block.type !== "break" && block.sceneStart
      ? { id: studioSceneAnchorId(block.sceneId) }
      : {}),
  };
}

/** The writing loop's bar under its scene draft. */
function LoopDraftBar({ draft }: { draft: SceneDraft }) {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const scene = state.planItems.find((item) => item.id === draft.sceneId);
  const queue = loop.queue;
  return (
    <DraftBar
      canKeep={isSceneDraftKeepable(draft)}
      draft={draft}
      isKeeping={loop.isKeeping}
      onDiscard={loop.discard}
      onKeep={() => void loop.keepScene()}
      onTryAgain={(note) => void loop.tryAgain(note)}
      progress={
        queue && queue.total > 1
          ? `scene ${queue.index} of ${queue.total} in this chapter`
          : null
      }
      title={scene?.title.trim() || "Untitled scene"}
    />
  );
}

/**
 * The book view: only what is written. Chapter openers, scene breaks and one
 * seamless editor per written moment, ending with a quiet "Up next" line.
 */
export function Manuscript() {
  const { state, dispatch } = useStudioStore();
  const proseById = useProseByMomentId();
  const loop = useWritingLoop();
  const preview = useBundlePreview();
  const storyId = state.story.id;
  const selectedItemId = state.selectedItemId;
  const draft = loop.draft;
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedItemId);
  useEffect(() => {
    selectedRef.current = selectedItemId;
  }, [selectedItemId]);
  const draftByMomentId = useMemo(
    () => new Map(draft?.beats.map((beat) => [beat.momentId, beat]) ?? []),
    [draft],
  );
  const draftNumbers = useMemo(
    () =>
      new Map(draft?.beats.map((beat, index) => [beat.momentId, index + 1])),
    [draft],
  );
  const canRedo =
    draft !== null && !isSceneDraftRunning(draft) && !loop.isKeeping;
  const chatDrafts = useMemo(
    () => chatDraftsOf(preview, state.planItems, proseById),
    [preview, proseById, state.planItems],
  );

  const layout = useMemo(
    () =>
      buildManuscriptLayout({
        activeMomentId,
        chatDraftByMomentId: chatDrafts.byMomentId,
        draftByMomentId,
        planItems: state.planItems,
        proposedBeats: chatDrafts.proposedBeats,
        proseById,
      }),
    [activeMomentId, chatDrafts, draftByMomentId, proseById, state.planItems],
  );
  const momentKey = useMemo(
    () =>
      layout.blocks
        .map((block) => {
          if (block.type === "moment") return block.moment.id;
          if (block.type === "draft") {
            return block.beats.map((beat) => beat.momentId).join(",");
          }
          return "";
        })
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

  const showUpNext =
    layout.upNext !== null &&
    !draft &&
    !loop.isKeeping &&
    chatDrafts.byMomentId.size === 0;

  return (
    // The full-width container lets draft labels sit in the margin when there is room.
    <div className="@container/manuscript">
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
            case "draft": {
              if (block.source === "chat") {
                const { bundleId } = chatDrafts;
                const scene = chatDrafts.byScene.get(block.sceneId);
                if (!bundleId || !scene) return null;
                return (
                  <Fragment key={`chat:${block.beats[0]?.momentId}`}>
                    <SceneDraftGroup
                      busy={false}
                      className="scroll-mt-24"
                      {...blockDataProps(block)}
                    >
                      {block.beats.map(({ draft: beat, momentId }, index) => {
                        const op = preview.proseOpsByMomentId.get(momentId);
                        return (
                          <DraftBeat
                            anchorId={
                              op
                                ? suggestionAnchorId(bundleId, op.id)
                                : undefined
                            }
                            beat={beat}
                            canRedo={false}
                            isSceneStart={block.sceneStart && index === 0}
                            key={momentId}
                            number={scene.beats.indexOf(beat) + 1}
                            onRedo={() => {}}
                            total={scene.beats.length}
                          />
                        );
                      })}
                    </SceneDraftGroup>
                    {block.endsDraft ? (
                      <ChatDraftBar
                        beats={scene.beats}
                        bundleId={bundleId}
                        opIds={scene.opIds}
                        sceneId={block.sceneId}
                      />
                    ) : null}
                  </Fragment>
                );
              }
              return draft ? (
                <Fragment key={`draft:${block.beats[0]?.momentId}`}>
                  <SceneDraftGroup
                    busy={isSceneDraftRunning(draft)}
                    className="scroll-mt-24"
                    {...blockDataProps(block)}
                  >
                    {block.beats.map(({ draft: beat, momentId }, index) => (
                      <DraftBeat
                        beat={beat}
                        canRedo={canRedo}
                        isSceneStart={block.sceneStart && index === 0}
                        key={momentId}
                        number={draftNumbers.get(momentId) ?? index + 1}
                        onRedo={(note) => void loop.redoBeat(momentId, note)}
                        total={draft.beats.length}
                      />
                    ))}
                  </SceneDraftGroup>
                  {block.endsDraft ? <LoopDraftBar draft={draft} /> : null}
                </Fragment>
              ) : null;
            }
          }
          return null;
        })}
        {layout.blocks.length === 0 ? (
          draft || chatDrafts.byMomentId.size > 0 ? null : (
            <div className="flex flex-col items-center gap-3">
              <p className="text-center font-sans text-caption text-muted-foreground">
                Nothing written yet.
                {layout.upNext ? "" : " Add a scene in the outline to begin."}
              </p>
              {showUpNext && layout.upNext ? (
                <UpNext sceneId={layout.upNext.sceneId} />
              ) : null}
            </div>
          )
        ) : (
          <div className="mt-20 flex flex-col items-center gap-4">
            <span
              aria-hidden="true"
              className="select-none text-muted-foreground/60"
            >
              ⁂
            </span>
            {showUpNext && layout.upNext ? (
              <UpNext sceneId={layout.upNext.sceneId} />
            ) : null}
          </div>
        )}
        <WritingStatus />
      </div>
    </div>
  );
}
