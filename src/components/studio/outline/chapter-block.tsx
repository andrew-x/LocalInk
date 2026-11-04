"use client";

import { Plus, X } from "lucide-react";
import { useCallback, useState } from "react";

import { Button } from "@/components/common/button";
import {
  ItemSuggestions,
  placeProposed,
  SuggestionLine,
  useOutlineSuggestions,
} from "@/components/studio/ai-box/outline-suggestions";
import { SuggestionsTag } from "@/components/studio/ai-box/suggestion-controls";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { usePatchPlanItem } from "@/components/studio/shared/use-patch-plan-item";
import { usePlanAi } from "@/components/studio/workspace/use-plan-ai";
import { usePlanTreeActions } from "@/components/studio/workspace/use-plan-tree-actions";
import {
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { scrollToStudioItem } from "@/components/studio/workspace/workspace-anchors";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import type { StudioPlanNode } from "@/lib/studio/plan-order";
import { cn } from "@/lib/util";

import { OutlineLine } from "./outline-line";
import { PlainText } from "./plain-text";
import { focusSceneCard, SceneCard } from "./scene-card";
import { MENU_ITEM_CLASS, OutlineMenu } from "./scene-menu";
import { useOutlineEditReporter, useOutlineOpen } from "./use-outline-open";
import { useOutlineView } from "./use-outline-view";

/** "1 to check", "3 to check": open flags anywhere inside the item. */
function CheckTag({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-accent/12 px-1.5 font-normal text-[0.6875rem] text-accent leading-[1.125rem]">
      {count} to check
    </span>
  );
}

/** "Planning…" with a stop button while the AI plans inside the item. */
function PlanningTag({
  item,
  noun,
}: {
  item: StudioPlanItemDto;
  noun: string;
}) {
  const planAi = usePlanAi();
  const pending = planAi.pending.get(item.id);
  if (!pending) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5 font-normal text-caption text-muted-foreground">
      {pending.phase === "planning" ? `Planning ${noun}…` : `Saving ${noun}…`}
      {pending.phase === "planning" ? (
        <Button
          aria-label={`Stop planning ${noun}`}
          className="size-5"
          onClick={(event) => {
            event.stopPropagation();
            planAi.cancel(item.id);
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" className="size-3" />
        </Button>
      ) : null}
    </span>
  );
}

/**
 * Write ▸ on a chapter: writes its scenes that still have unwritten (or no)
 * beats in order, each waiting for Keep.
 */
function WriteChapterButton({ chapter }: { chapter: StudioPlanNode }) {
  const loop = useWritingLoop();
  const proseByMoment = useProseByMomentId();
  const writable = chapter.children.some(
    (scene) =>
      scene.kind === "scene" &&
      (scene.children.length === 0 ||
        scene.children.some(
          (beat) => !proseByMoment.get(beat.id)?.markdown.trim(),
        )),
  );
  if (!writable) return null;
  return (
    <Button
      className="h-6 px-2 font-semibold text-caption text-primary hover:text-primary"
      disabled={loop.isKeeping || loop.queue?.chapterId === chapter.id}
      onClick={() => void loop.writeChapter(chapter.id)}
      size="sm"
      type="button"
      variant="ghost"
    >
      Write ▸
    </Button>
  );
}

/**
 * A chapter line. Open, it shows its description (autosaved), its scenes as
 * lines (one of them may be an open card) and "+ Scene".
 */
export function ChapterBlock({ chapter }: { chapter: StudioPlanNode }) {
  const { dispatch } = useStudioStore();
  const view = useOutlineView();
  const { collapse, openChapter, openChapterId, openScene, openSceneId } =
    useOutlineOpen();
  const planAi = usePlanAi();
  const { add, remove } = usePlanTreeActions();
  const { insideCount, proposedUnder } = useOutlineSuggestions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isOpen = openChapterId === chapter.id;
  const scenes = chapter.children;
  const status = view.statuses.get(chapter.id) ?? "planned";

  function select(item: StudioPlanItemDto) {
    // The chat's "looking at" follows the outline.
    dispatch({ type: "select", itemId: item.id });
    if (view.statuses.get(item.id) === "written") {
      scrollToStudioItem(item.id, { manuscript: true });
    }
  }

  function toggleChapter() {
    if (isOpen) {
      collapse();
      return;
    }
    openChapter(chapter.id);
    select(chapter);
  }

  function openSceneCard(scene: StudioPlanItemDto) {
    openScene(scene.id);
    select(scene);
    focusSceneCard(scene.id, "whatHappens");
  }

  async function addScene() {
    const created = await add(chapter);
    if (!created) return;
    openScene(created.id);
    focusSceneCard(created.id, "title");
  }

  async function confirmRemove() {
    setDeleting(true);
    try {
      await remove(chapter);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div>
      <OutlineLine
        actions={
          <>
            <WriteChapterButton chapter={chapter} />
            {scenes.length === 0 && !planAi.pending.has(chapter.id) ? (
              <Button
                className="h-6 px-2 font-normal text-caption text-muted-foreground"
                onClick={() => void planAi.fleshOut(chapter.id)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <span aria-hidden="true">✦</span> Plan scenes
              </Button>
            ) : null}
            <OutlineMenu
              label={`Chapter ${view.chapterNumbers.get(chapter.id) ?? ""} actions`}
              onOpenChange={setMenuOpen}
              open={menuOpen}
            >
              <button
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  setMenuOpen(false);
                  view.setRenamingId(chapter.id);
                }}
                type="button"
              >
                Rename
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                className={cn(MENU_ITEM_CLASS, "text-destructive")}
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDelete(true);
                }}
                type="button"
              >
                Delete chapter
              </button>
            </OutlineMenu>
          </>
        }
        isOpen={isOpen}
        isReading={view.readingIds.has(chapter.id)}
        item={chapter}
        number={view.chapterNumbers.get(chapter.id)}
        onOpen={toggleChapter}
        status={status}
        tags={
          <>
            <PlanningTag item={chapter} noun="scenes" />
            <CheckTag count={view.openFlags.get(chapter.id) ?? 0} />
            <SuggestionsTag count={isOpen ? 0 : insideCount(chapter.id)} />
          </>
        }
        wordCount={view.wordCounts.get(chapter.id)}
      />
      <ItemSuggestions className="pl-[1.625rem]" item={chapter} />
      {isOpen ? (
        // biome-ignore lint/a11y/useSemanticElements: a tree item's children group
        <div className="flex flex-col pl-[1.625rem]" role="group">
          <ChapterDescription chapter={chapter} />
          {placeProposed(scenes, proposedUnder(chapter.id)).map((line) => {
            if (line.type === "proposed") {
              return <SuggestionLine item={line.item} key={line.item.opId} />;
            }
            const scene = line.item;
            return openSceneId === scene.id ? (
              <SceneCard key={scene.id} scene={scene} />
            ) : (
              <div key={scene.id}>
                <OutlineLine
                  isOpen={false}
                  isReading={view.readingIds.has(scene.id)}
                  item={scene}
                  onOpen={() => openSceneCard(scene)}
                  status={view.statuses.get(scene.id) ?? "planned"}
                  tags={
                    <>
                      <PlanningTag item={scene} noun="beats" />
                      <CheckTag count={view.openFlags.get(scene.id) ?? 0} />
                      <SuggestionsTag count={insideCount(scene.id)} />
                    </>
                  }
                />
                <ItemSuggestions item={scene} />
              </div>
            );
          })}
          <button
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-left font-normal text-label-sm text-muted-foreground/70 outline-none hover:bg-foreground/5 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => void addScene()}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3" />
            Scene
          </button>
        </div>
      ) : null}
      <StudioConfirmDialog
        confirmLabel="Delete"
        description="Everything inside it is deleted too, including any prose already written. You can undo right after."
        destructive
        loading={deleting}
        onConfirm={() => void confirmRemove()}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title="Delete this chapter?"
      />
    </div>
  );
}

function ChapterDescription({ chapter }: { chapter: StudioPlanItemDto }) {
  const patchItem = usePatchPlanItem();
  const onDirtyChange = useOutlineEditReporter();

  const save = useCallback(
    async (changed: { whatHappens?: string }) => {
      if (changed.whatHappens === undefined) return false;
      const saved = await patchItem(chapter.id, {
        whatHappens: changed.whatHappens,
      });
      return saved !== null;
    },
    [chapter.id, patchItem],
  );

  const { flush, setValue, values } = useAutosaveFields<"whatHappens">({
    onDirtyChange,
    save,
    serverValues: { whatHappens: chapter.whatHappens },
  });

  return (
    <div className="pr-2 pb-1.5 pl-2">
      <PlainText
        className="text-muted-foreground focus-visible:text-foreground"
        label="What happens in this chapter"
        maxLength={20_000}
        onBlur={() => void flush(true)}
        onChange={(event) => setValue("whatHappens", event.target.value)}
        placeholder="What happens in this chapter"
        value={values.whatHappens}
      />
    </div>
  );
}
