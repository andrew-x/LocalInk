"use client";

import { ChevronRight, ChevronUp, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { PlainText } from "@/components/studio/outline/plain-text";
import {
  MENU_ITEM_CLASS,
  OutlineMenu,
} from "@/components/studio/outline/scene-menu";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { DetailsList } from "./details-list";
import {
  entryKindLabel,
  sceneCountLabel,
  sceneCountsByEntry,
} from "./entry-line";
import { RelationshipEditor } from "./relationship-editor";
import { TrackingSection } from "./tracking-section";
import { useDeleteEntry } from "./use-delete-entry";
import { type EntryPatch, usePatchEntry } from "./use-patch-entry";

type EntryCardProps = {
  entry: StudioEntryDto;
  /** Select the name for typing, for an entry that was just created. */
  focusName?: boolean;
  onClose?: () => void;
  onDeleted?: () => void;
};

/**
 * One open entry: its name, the author's paragraph ("In your words"), and a
 * collapsed "What the AI is tracking" disclosure. Mount it with
 * `key={entry.id}` so drafts never cross entries.
 */
export function EntryCard({
  entry,
  focusName,
  onClose,
  onDeleted,
}: EntryCardProps) {
  const { state } = useStudioStore();
  const patchEntry = usePatchEntry();
  const deleteEntry = useDeleteEntry();
  const [tracking, setTracking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const sceneCount = useMemo(
    () => sceneCountsByEntry(state.planItems).get(entry.id) ?? 0,
    [entry.id, state.planItems],
  );

  // An entry opened from elsewhere (a chip, a link) should be on screen.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const save = useCallback(
    async (
      changed: Partial<Record<"name" | "summary", string>>,
      final: boolean,
    ) => {
      const patch: EntryPatch = {};
      const keep: "name"[] = [];
      if (changed.name !== undefined) {
        const trimmed = changed.name.trim();
        // A blank name, or one still being typed, stays local until blur.
        if (!trimmed || (!final && trimmed !== changed.name)) keep.push("name");
        else patch.name = trimmed;
      }
      if (changed.summary !== undefined) patch.summary = changed.summary;
      if (Object.keys(patch).length > 0) {
        if ((await patchEntry(entry.id, patch)) === null) return false;
      }
      return keep.length > 0 ? keep : true;
    },
    [entry.id, patchEntry],
  );

  const serverValues = useMemo(
    () => ({ name: entry.name, summary: entry.summary }),
    [entry.name, entry.summary],
  );
  const { flush, setValue, values } = useAutosaveFields<"name" | "summary">({
    save,
    serverValues,
  });

  async function confirmDelete() {
    setIsDeleting(true);
    try {
      if (await deleteEntry(entry)) {
        setConfirmingDelete(false);
        onDeleted?.();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <section
      aria-label={entry.name || "Entry"}
      className="my-1 flex flex-col gap-3 rounded-lg border border-border bg-background px-3 pt-2.5 pb-3 shadow-[inset_2px_0_0_var(--color-primary)]"
      ref={rootRef}
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <Input
            aria-label="Name"
            autoFocus={focusName}
            className="h-7 border-transparent bg-transparent px-1.5 font-semibold text-body shadow-none"
            maxLength={200}
            onBlur={() => void flush(true)}
            onChange={(event) => setValue("name", event.target.value)}
            onFocus={(event) => {
              if (focusName) event.currentTarget.select();
            }}
            value={values.name}
          />
          <OutlineMenu
            label={`More for ${entry.name}`}
            onOpenChange={setMenuOpen}
            open={menuOpen}
          >
            <button
              className={cn(MENU_ITEM_CLASS, "gap-2 text-destructive")}
              onClick={() => {
                setMenuOpen(false);
                setConfirmingDelete(true);
              }}
              type="button"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              Delete
            </button>
          </OutlineMenu>
          {onClose ? (
            <Button
              aria-label="Close"
              className="size-6 text-muted-foreground"
              onClick={onClose}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ChevronUp aria-hidden="true" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <p className="px-1.5 text-caption text-muted-foreground">
          {entryKindLabel(entry)}
          {sceneCount > 0 ? ` · in ${sceneCountLabel(sceneCount)}` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1 px-1.5">
        <p
          aria-hidden="true"
          className="font-semibold text-[11px] text-muted-foreground/80 uppercase tracking-wider"
        >
          In your words
        </p>
        <PlainText
          className="text-label-sm leading-[1.5]"
          label="In your words"
          maxLength={20_000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("summary", event.target.value)}
          placeholder="Write a paragraph about them in your own words. The AI keeps track of the rest."
          value={values.summary}
        />
      </div>

      {entry.type === "relationship" ? (
        <div className="px-1.5">
          <RelationshipEditor entry={entry} />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 px-1.5">
        <button
          aria-expanded={tracking}
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-sm text-label-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setTracking((open) => !open)}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform",
              tracking && "rotate-90",
            )}
          />
          What the AI is tracking
        </button>
        {tracking ? (
          <>
            <TrackingSection entry={entry} />
            <DetailsList entry={entry} />
          </>
        ) : null}
      </div>

      <StudioConfirmDialog
        confirmLabel="Delete"
        description="This also deletes everything tracked for it over the story, and removes it from the scenes it appears in. This cannot be undone."
        destructive
        loading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={setConfirmingDelete}
        open={confirmingDelete}
        title={`Delete ${entry.name}?`}
      />
    </section>
  );
}
