"use client";

import { X } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/common/button";
import { ItemSuggestions } from "@/components/studio/ai-box/outline-suggestions";
import { isSceneDraftRunning } from "@/components/studio/manuscript/scene-draft-model";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import {
  type PlanItemPatch,
  usePatchPlanItem,
} from "@/components/studio/shared/use-patch-plan-item";
import { usePlanAi } from "@/components/studio/workspace/use-plan-ai";
import { useProseByMomentId } from "@/components/studio/workspace/use-studio-store";
import { studioOutlineLineId } from "@/components/studio/workspace/workspace-anchors";
import { planItemLabel } from "@/lib/studio/plan-labels";
import type { StudioPlanNode } from "@/lib/studio/plan-order";

import { BeatList } from "./beat-list";
import { FlagNotes } from "./flag-notes";
import { StatusDot } from "./outline-line";
import { PlainText } from "./plain-text";
import { SceneMenu } from "./scene-menu";
import { useOutlineEditReporter, useOutlineOpen } from "./use-outline-open";
import { useOutlineView } from "./use-outline-view";
import { WhoChips } from "./who-chips";

type FieldKey = "title" | "whatHappens";

function sceneFieldId(sceneId: string, field: FieldKey): string {
  return `studio-scene-${field}-${sceneId}`;
}

/**
 * Focuses a field in a scene card that is opening, caret at the end. A card
 * for a scene created a moment ago may need another frame to render.
 */
export function focusSceneCard(sceneId: string, field: FieldKey, attempts = 3) {
  requestAnimationFrame(() => {
    const element = document.getElementById(sceneFieldId(sceneId, field));
    if (
      !(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement)
    ) {
      if (attempts > 1) focusSceneCard(sceneId, field, attempts - 1);
      return;
    }
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
  });
}

/**
 * An open scene, edited in place: title, description, beats, who's in it and
 * flag notes, with Write ▸ (or Plan beats) and ⋯ in the header. Keyed by the
 * scene id, so its local drafts never carry over to another scene, and it
 * flushes them on blur and when it closes.
 */
export function SceneCard({ scene }: { scene: StudioPlanNode }) {
  const { statuses, tabStopId } = useOutlineView();
  const { close } = useOutlineOpen();
  const patchItem = usePatchPlanItem();
  const onDirtyChange = useOutlineEditReporter();
  const planAi = usePlanAi();
  const replan = useReplanState(scene);
  const status = statuses.get(scene.id) ?? "planned";
  const label = planItemLabel(scene);
  // Set once a description edit lands while the scene has beats, so the card
  // can offer a replan. Edits before the first plan have nothing to replan.
  const [descriptionChanged, setDescriptionChanged] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const hasBeats = useRef(scene.children.length > 0);
  useEffect(() => {
    hasBeats.current = scene.children.length > 0;
  }, [scene.children.length]);

  const save = useCallback(
    async (changed: Partial<Record<FieldKey, string>>, final: boolean) => {
      const patch: PlanItemPatch = {};
      if (changed.title !== undefined) {
        patch.title = final ? changed.title.trim() : changed.title;
      }
      if (changed.whatHappens !== undefined) {
        patch.whatHappens = changed.whatHappens;
      }
      if (Object.keys(patch).length === 0) return true;
      const saved = (await patchItem(scene.id, patch)) !== null;
      if (saved && patch.whatHappens !== undefined && hasBeats.current) {
        setDescriptionChanged(true);
      }
      return saved;
    },
    [patchItem, scene.id],
  );

  const { flush, setValue, values } = useAutosaveFields<FieldKey>({
    onDirtyChange,
    save,
    serverValues: { title: scene.title, whatHappens: scene.whatHappens },
  });

  /** The route plans from the saved description, so land edits first. */
  async function replanBeats() {
    if (!(await flush(true))) return;
    setDescriptionChanged(false);
    await planAi.replan(scene.id);
  }

  function focusLine() {
    requestAnimationFrame(() =>
      document.getElementById(studioOutlineLineId(scene.id))?.focus(),
    );
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Keys from portaled menus and dialogs are not the card's.
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      !event.currentTarget.contains(event.target)
    ) {
      return;
    }
    event.preventDefault();
    close();
    focusLine();
  }

  function handleHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      focusSceneCard(scene.id, "whatHappens");
    } else if (event.key === "F2") {
      event.preventDefault();
      focusSceneCard(scene.id, "title");
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the card closes it
    <div
      className="my-1 rounded-lg border border-border bg-background px-2.5 pt-1 pb-2 shadow-[inset_2px_0_0_var(--color-primary)]"
      onKeyDown={handleCardKeyDown}
    >
      <div
        aria-expanded
        aria-label={`Scene: ${label}`}
        aria-level={2}
        className="flex h-7 min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        data-outline-line={scene.id}
        id={studioOutlineLineId(scene.id)}
        onKeyDown={handleHeaderKeyDown}
        role="treeitem"
        tabIndex={tabStopId === scene.id ? 0 : -1}
      >
        <StatusDot status={status} />
        <input
          aria-label="Scene title"
          className="h-6 min-w-0 flex-1 rounded-sm bg-transparent font-semibold text-label-sm outline-none placeholder:font-normal placeholder:text-muted-foreground/70 focus-visible:bg-muted/40"
          id={sceneFieldId(scene.id, "title")}
          maxLength={200}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("title", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              focusSceneCard(scene.id, "whatHappens");
            }
          }}
          placeholder="Title (optional)"
          value={values.title}
        />
        <SceneActions
          canReplan={replan.available}
          onReplan={() => void replanBeats()}
          scene={scene}
        />
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: the card body belongs to the scene's tree item */}
      <div className="mt-0.5 flex flex-col gap-1.5 pl-[15px]" role="group">
        <ItemSuggestions item={scene} />
        <PlainText
          className="text-foreground/90"
          id={sceneFieldId(scene.id, "whatHappens")}
          label="What happens in this scene"
          maxLength={20_000}
          onBlur={() => {
            setEditingDescription(false);
            void flush(true);
          }}
          onChange={(event) => setValue("whatHappens", event.target.value)}
          onFocus={() => setEditingDescription(true)}
          placeholder="What happens, and how it should feel"
          value={values.whatHappens}
        />
        {descriptionChanged && !editingDescription && replan.available ? (
          <div className="flex items-center gap-1 text-caption text-muted-foreground">
            <span className="min-w-0 flex-1">
              The beats were planned from the earlier description.
            </span>
            <Button
              className="h-6 px-2 text-caption text-primary hover:text-primary"
              onClick={() => void replanBeats()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true">✦</span> Replan beats
            </Button>
            <Button
              aria-label="Keep these beats"
              className="size-6"
              onClick={() => setDescriptionChanged(false)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          </div>
        ) : null}
        <BeatList scene={scene} />
        <WhoChips scene={scene} />
        <FlagNotes scene={scene} />
      </div>
    </div>
  );
}

/**
 * Whether the scene's beats can be replanned now: it has beats that nobody
 * wrote or edited (the server also keeps beats with version history), and
 * nothing is planning, drafting, or keeping in it.
 */
function useReplanState(scene: StudioPlanNode) {
  const planAi = usePlanAi();
  const loop = useWritingLoop();
  const proseByMoment = useProseByMomentId();
  const replaceable = scene.children.some(
    (beat) =>
      beat.authorFields.length === 0 &&
      !proseByMoment.get(beat.id)?.markdown.trim(),
  );
  const busy =
    planAi.pending.has(scene.id) ||
    loop.draft?.sceneId === scene.id ||
    loop.isKeeping;
  return { available: replaceable && !busy };
}

/** Write ▸ when there are unwritten beats, Plan beats when there are none. */
function SceneActions({
  canReplan,
  onReplan,
  scene,
}: {
  canReplan: boolean;
  onReplan: () => void;
  scene: StudioPlanNode;
}) {
  const planAi = usePlanAi();
  const loop = useWritingLoop();
  const proseByMoment = useProseByMomentId();
  const beats = scene.children;
  const pending = planAi.pending.get(scene.id);
  const writing =
    loop.draft?.sceneId === scene.id && isSceneDraftRunning(loop.draft);
  const unwritten = beats.some(
    (beat) => !proseByMoment.get(beat.id)?.markdown.trim(),
  );

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {pending ? (
        <span className="flex items-center gap-0.5 text-caption text-muted-foreground">
          {pending.phase === "planning" ? "Planning beats…" : "Saving beats…"}
          {pending.phase === "planning" ? (
            <Button
              aria-label="Stop planning beats"
              className="size-6"
              onClick={() => planAi.cancel(scene.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          ) : null}
        </span>
      ) : writing ? (
        <span className="px-1.5 text-caption text-muted-foreground">
          Writing…
        </span>
      ) : beats.length === 0 ? (
        <Button
          className="h-6 px-2 text-caption text-muted-foreground"
          onClick={() => void planAi.fleshOut(scene.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">✦</span> Plan beats
        </Button>
      ) : unwritten ? (
        <Button
          className="h-6 px-2 font-semibold text-caption text-primary hover:text-primary"
          disabled={loop.isKeeping}
          onClick={() => void loop.writeScene(scene.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Write ▸
        </Button>
      ) : null}
      <SceneMenu canReplan={canReplan} onReplan={onReplan} scene={scene} />
    </div>
  );
}
