"use client";

import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/common/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { flushMomentEditor } from "@/components/studio/manuscript/editor-registry";
import { readBackStudioMoment } from "@/components/studio/manuscript/read-back-client";
import { studioErrorMessage } from "@/components/studio/studio-fetch";
import { usePlanTreeActions } from "@/components/studio/workspace/use-plan-tree-actions";
import {
  useProseByMomentId,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanNode } from "@/lib/studio/plan-order";
import { cn } from "@/lib/util";

import { BeatVersionsDialog } from "./beat-versions-dialog";

export const MENU_ITEM_CLASS =
  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-label-sm font-normal text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50";

const FLUSH_FAILED =
  "Your edits to this scene could not be saved first, so it was not re-read.";

/** A small "⋯" menu trigger and list, shared by scene cards and chapters. */
export function OutlineMenu({
  children,
  label,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  label: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={label}
          className="size-6 text-muted-foreground"
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-44 flex-col p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** The scene card's ⋯: Versions…, Re-read, Delete. */
export function SceneMenu({ scene }: { scene: StudioPlanNode }) {
  const { state, dispatch } = useStudioStore();
  const proseByMoment = useProseByMomentId();
  const { remove } = usePlanTreeActions();
  const storyId = state.story.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rereading, setRereading] = useState(false);

  const written = scene.children.filter((beat) =>
    proseByMoment.get(beat.id)?.markdown.trim(),
  );

  function choose(action: () => void) {
    setMenuOpen(false);
    action();
  }

  /** Re-reads every written beat in order, as Keep and restore do. */
  async function reread() {
    if (rereading) return;
    setRereading(true);
    let found = false;
    try {
      for (const beat of written) {
        const revision = proseByMoment.get(beat.id)?.revision ?? 0;
        // The route reads saved prose, so land pending edits first.
        if ((await flushMomentEditor(beat.id, revision)) === null) {
          toast.error(FLUSH_FAILED);
          return;
        }
        const patch = await readBackStudioMoment({
          storyId,
          momentId: beat.id,
          force: true,
        });
        if (patch) {
          found = true;
          dispatch({ type: "merge", ...patch });
        }
      }
      if (!found) toast("Nothing new to record from this scene.");
    } catch (error) {
      toast.error(studioErrorMessage(error, "The scene could not be re-read."));
    } finally {
      setRereading(false);
    }
  }

  async function confirmRemove() {
    setDeleting(true);
    try {
      await remove(scene);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <OutlineMenu
        label="Scene actions"
        onOpenChange={setMenuOpen}
        open={menuOpen}
      >
        <button
          className={MENU_ITEM_CLASS}
          onClick={() => choose(() => setVersionsOpen(true))}
          type="button"
        >
          Versions…
        </button>
        <button
          className={MENU_ITEM_CLASS}
          disabled={written.length === 0 || rereading}
          onClick={() => choose(() => void reread())}
          type="button"
        >
          {rereading ? "Re-reading…" : "Re-read"}
        </button>
        <div className="my-1 h-px bg-border" />
        <button
          className={cn(MENU_ITEM_CLASS, "text-destructive")}
          onClick={() => choose(() => setConfirmDelete(true))}
          type="button"
        >
          Delete scene
        </button>
      </OutlineMenu>
      <BeatVersionsDialog
        onOpenChange={setVersionsOpen}
        open={versionsOpen}
        scene={scene}
      />
      <StudioConfirmDialog
        confirmLabel="Delete"
        description="Its beats and any prose already written go with it. You can undo right after."
        destructive
        loading={deleting}
        onConfirm={() => void confirmRemove()}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title="Delete this scene?"
      />
    </>
  );
}
