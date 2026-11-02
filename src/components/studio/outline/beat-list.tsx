"use client";

import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { usePatchPlanItem } from "@/components/studio/shared/use-patch-plan-item";
import {
  resolvePlanDrop,
  usePlanTreeActions,
} from "@/components/studio/workspace/use-plan-tree-actions";
import {
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import type { StudioPlanNode } from "@/lib/studio/plan-order";
import { cn } from "@/lib/util";

import { PlainText } from "./plain-text";
import { useOutlineEditReporter } from "./use-outline-open";
import { useOutlineView } from "./use-outline-view";

function beatFieldId(beatId: string): string {
  return `studio-beat-${beatId}`;
}

/** Puts the caret at the end (or start) of a beat's field. */
function focusBeat(beatId: string, at: "start" | "end" = "end") {
  const field = document.getElementById(beatFieldId(beatId));
  if (!(field instanceof HTMLTextAreaElement)) return;
  field.focus();
  const position = at === "end" ? field.value.length : 0;
  field.setSelectionRange(position, position);
}

/**
 * A scene's beats, one editable line each. Enter adds a beat after the
 * current one, Backspace on an empty beat removes it (confirming first when
 * it has prose), Alt+↑/↓ moves it, and ↑/↓ at the edges step between beats.
 */
export function BeatList({ scene }: { scene: StudioPlanNode }) {
  const { state } = useStudioStore();
  const proseByMoment = useProseByMomentId();
  const { add, move, remove } = usePlanTreeActions();
  const beats = scene.children;
  /** A beat just created here; it takes focus once it renders. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<StudioPlanItemDto | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const addingAtEnd = useRef(false);

  useEffect(() => {
    if (!focusId || !beats.some((beat) => beat.id === focusId)) return;
    focusBeat(focusId);
    setFocusId(null);
  }, [beats, focusId]);

  async function addAfter(beat: StudioPlanItemDto | null) {
    const created = await add(beat ?? scene);
    if (created) setFocusId(created.id);
  }

  async function removeBeat(beat: StudioPlanItemDto) {
    const index = beats.findIndex((candidate) => candidate.id === beat.id);
    const neighbor = beats[index - 1] ?? beats[index + 1] ?? null;
    await remove(beat);
    if (neighbor) requestAnimationFrame(() => focusBeat(neighbor.id));
  }

  async function requestRemove(beat: StudioPlanItemDto) {
    if (proseByMoment.get(beat.id)?.markdown.trim()) setPendingRemove(beat);
    else await removeBeat(beat);
  }

  async function addAtEnd() {
    // A double click must not add two beats.
    if (addingAtEnd.current) return;
    addingAtEnd.current = true;
    try {
      await addAfter(beats.at(-1) ?? null);
    } finally {
      addingAtEnd.current = false;
    }
  }

  function step(beat: StudioPlanItemDto, delta: -1 | 1): boolean {
    const index = beats.findIndex((candidate) => candidate.id === beat.id);
    const next = beats[index + delta];
    if (!next) return false;
    focusBeat(next.id, delta > 0 ? "start" : "end");
    return true;
  }

  function moveBeat(beat: StudioPlanItemDto, delta: -1 | 1) {
    const index = beats.findIndex((candidate) => candidate.id === beat.id);
    const neighbor = beats[index + delta];
    if (!neighbor) return;
    const drop = resolvePlanDrop(state.planItems, beat, neighbor, delta < 0);
    if (drop) void move(beat, drop);
  }

  async function confirmRemove() {
    const beat = pendingRemove;
    if (!beat) return;
    setRemoving(true);
    try {
      await removeBeat(beat);
    } finally {
      setRemoving(false);
      setPendingRemove(null);
    }
  }

  return (
    <>
      <ol aria-label="Beats" className="flex flex-col">
        {beats.map((beat, index) => (
          <BeatLine
            beat={beat}
            key={beat.id}
            number={index + 1}
            onEnter={() => addAfter(beat)}
            onMove={(delta) => moveBeat(beat, delta)}
            onRemove={() => requestRemove(beat)}
            onStep={(delta) => step(beat, delta)}
          />
        ))}
        <li>
          <button
            className="w-full rounded-sm py-0.5 pl-3.5 text-left text-label-sm font-normal text-muted-foreground/70 italic outline-none hover:text-muted-foreground focus-visible:bg-muted/40"
            onClick={() => void addAtEnd()}
            type="button"
          >
            Add a beat…
          </button>
        </li>
      </ol>
      <StudioConfirmDialog
        confirmLabel="Remove"
        description="This beat has prose, and it is removed with it. You can undo right after."
        destructive
        loading={removing}
        onConfirm={() => void confirmRemove()}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        open={pendingRemove !== null}
        title="Remove this beat?"
      />
    </>
  );
}

function BeatLine({
  beat,
  number,
  onEnter,
  onMove,
  onRemove,
  onStep,
}: {
  beat: StudioPlanItemDto;
  number: number;
  onEnter: () => Promise<void>;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => Promise<void>;
  onStep: (delta: -1 | 1) => boolean;
}) {
  const { statuses } = useOutlineView();
  const patchItem = usePatchPlanItem();
  const onDirtyChange = useOutlineEditReporter();
  // Mint when written, a ring while drafting, grey when planned.
  const status = statuses.get(beat.id) ?? "planned";

  const save = useCallback(
    async (changed: { whatHappens?: string }) => {
      if (changed.whatHappens === undefined) return false;
      const saved = await patchItem(beat.id, {
        whatHappens: changed.whatHappens,
      });
      return saved !== null;
    },
    [beat.id, patchItem],
  );

  const { flush, setValue, values } = useAutosaveFields<"whatHappens">({
    onDirtyChange,
    save,
    serverValues: { whatHappens: beat.whatHappens },
  });
  /** An Enter or Backspace still adding or removing; repeats are ignored. */
  const busy = useRef(false);

  async function once(task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await task();
    } finally {
      busy.current = false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    const field = event.currentTarget;
    const atStart = field.selectionStart === 0 && field.selectionEnd === 0;
    const atEnd =
      field.selectionStart === field.value.length &&
      field.selectionEnd === field.value.length;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (event.repeat) return;
      void once(async () => {
        // The new beat's save queue is separate; land this one first.
        await flush(true);
        await onEnter();
      });
    } else if (event.key === "Backspace" && field.value === "") {
      event.preventDefault();
      if (event.repeat) return;
      void once(async () => {
        // Settle the cleared text first. Once the beat is gone, a late save
        // would target a missing item. Typing since then cancels the removal.
        if (!(await flush(true)) || field.value !== "") return;
        await onRemove();
      });
    } else if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      onMove(-1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      onMove(1);
    } else if (event.key === "ArrowUp" && atStart) {
      if (onStep(-1)) event.preventDefault();
    } else if (event.key === "ArrowDown" && atEnd) {
      if (onStep(1)) event.preventDefault();
    }
  }

  return (
    <li className="relative flex items-start gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "mt-[0.4rem] ml-0.5 shrink-0 rounded-full",
          status === "written" && "size-1 bg-studio-status-written",
          status === "planned" && "size-1 bg-studio-status-planned",
          status === "flagged" && "size-1 bg-studio-status-flagged",
          status === "drafting" &&
            "-ml-px size-[6px] border-[1.5px] border-studio-status-written",
        )}
      />
      <PlainText
        className={cn(
          status === "planned" ? "text-muted-foreground" : "text-foreground/90",
          "focus-visible:text-foreground",
        )}
        id={beatFieldId(beat.id)}
        label={`Beat ${number}`}
        maxLength={20_000}
        onBlur={() => void flush(true)}
        onChange={(event) => setValue("whatHappens", event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="What happens in this beat"
        value={values.whatHappens}
      />
    </li>
  );
}
