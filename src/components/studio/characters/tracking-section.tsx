"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";

import { createStudioChange } from "@/actions/studio/create-studio-change";
import { deleteStudioChange } from "@/actions/studio/delete-studio-change";
import { updateStudioChange } from "@/actions/studio/update-studio-change";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { PlainText } from "@/components/studio/outline/plain-text";
import {
  MENU_ITEM_CLASS,
  OutlineMenu,
} from "@/components/studio/outline/scene-menu";
import { entryNameMap } from "@/components/studio/shared/inspect-labels";
import {
  useProseByMomentId,
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioChangeDto, StudioEntryDto } from "@/lib/studio/contracts";
import { planItemLabel } from "@/lib/studio/plan-labels";
import { getAncestors } from "@/lib/studio/plan-order";
import { lastKeptBeatAtOrBefore } from "@/lib/studio/reading-point";
import { computeStateComingOut } from "@/lib/studio/state";
import { cn } from "@/lib/util";

import { OverTheStory } from "./over-the-story";
import { SectionHeading } from "./section-heading";

const SAVE_FAILED = "The change could not be saved.";

/** "forward" corrects from here on; "origin" fixes the original record. */
type EditVariant = "forward" | "origin";

type TrackedLineProps = {
  label: string;
  /** Repeated list values show their label once. */
  showLabel: boolean;
  value: string;
  menu: "origin" | "delete";
  onSave: (text: string, variant: EditVariant) => Promise<boolean>;
  onDelete: () => void;
  /** Lists edit the value's own record; single values edit from here on. */
  editVariant: EditVariant;
};

function TrackedLine({
  editVariant,
  label,
  menu,
  onDelete,
  onSave,
  showLabel,
  value,
}: TrackedLineProps) {
  const [editing, setEditing] = useState<EditVariant | null>(null);
  const [draft, setDraft] = useState(value);
  const [menuOpen, setMenuOpen] = useState(false);
  // Enter and the blur it causes must not both save.
  const settled = useRef(false);

  function begin(variant: EditVariant) {
    settled.current = false;
    setDraft(value);
    setEditing(variant);
  }

  async function commit() {
    if (settled.current || editing === null) return;
    settled.current = true;
    const next = draft.trim();
    if (!next || next === value.trim()) {
      setEditing(null);
      return;
    }
    if (await onSave(next, editing)) setEditing(null);
    else settled.current = false;
  }

  function cancel() {
    settled.current = true;
    setEditing(null);
  }

  return (
    <li className="group/tracked flex items-start gap-2 py-0.5 text-label-sm">
      <span className="w-24 shrink-0 text-muted-foreground">
        {showLabel ? label : null}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <>
            <PlainText
              autoFocus
              label={`${label}: edit`}
              maxLength={4000}
              onBlur={() => void commit()}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancel();
                } else if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void commit();
                }
              }}
              value={draft}
            />
            <p className="text-caption text-muted-foreground/80">
              {editing === "forward"
                ? "Saves as true from here on."
                : "Changes the original record."}
            </p>
          </>
        ) : (
          <button
            aria-label={`${label}: ${value}. Edit`}
            className="w-full cursor-text rounded-sm text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => begin(editVariant)}
            type="button"
          >
            {value}
          </button>
        )}
      </div>
      {editing ? null : (
        <span
          className={cn(
            "shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tracked:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          <OutlineMenu
            label={`More for ${label}`}
            onOpenChange={setMenuOpen}
            open={menuOpen}
          >
            <button
              className={cn(
                MENU_ITEM_CLASS,
                menu === "delete" && "text-destructive",
              )}
              onClick={() => {
                setMenuOpen(false);
                if (menu === "delete") onDelete();
                else begin("origin");
              }}
              type="button"
            >
              {menu === "delete" ? "Delete" : "Fix where it started"}
            </button>
          </OutlineMenu>
        </span>
      )}
    </li>
  );
}

/**
 * "Where they are now": the entry's computed state coming out of the last
 * written beat at the reading point, as "label: value" lines. Corrections
 * are author records, so read-back leaves them alone. Render it only while
 * the disclosure is open; it replays every change.
 */
export function TrackingSection({ entry }: { entry: StudioEntryDto }) {
  const { state, dispatch } = useStudioStore();
  const proseByMoment = useProseByMomentId();
  const run = useRunStudioAction();
  const [showAll, setShowAll] = useState(false);
  const [deleting, setDeleting] = useState<StudioChangeDto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { changes, entries, planItems, readingItemId } = state;
  const storyId = state.story.id;

  const point = useMemo(
    () => lastKeptBeatAtOrBefore(planItems, proseByMoment, readingItemId),
    [planItems, proseByMoment, readingItemId],
  );
  const tracked = useMemo(
    () =>
      point
        ? (computeStateComingOut({ changes, entries, planItems }, point).get(
            entry.id,
          ) ?? null)
        : null,
    [changes, entries, entry.id, planItems, point],
  );
  const names = useMemo(() => entryNameMap(entries), [entries]);
  const sceneTitle = useMemo(() => {
    if (!point) return null;
    const scene = getAncestors(planItems, point).findLast(
      (item) => item.kind === "scene",
    );
    return scene ? planItemLabel(scene) : null;
  }, [planItems, point]);

  async function update(change: StudioChangeDto, value: string) {
    const updated = await run(
      updateStudioChange({
        storyId,
        changeId: change.id,
        patch: {
          aspect: change.aspect,
          mode: change.mode,
          aboutEntryId: change.aboutEntryId,
          value,
        },
      }),
      SAVE_FAILED,
    );
    if (!updated) return false;
    dispatch({ type: "merge", changes: [updated] });
    return true;
  }

  async function createFromHere(
    change: StudioChangeDto,
    pointId: string,
    value: string,
  ) {
    const created = await run(
      createStudioChange({
        storyId,
        entryId: entry.id,
        aspect: change.aspect,
        mode: change.mode,
        aboutEntryId: change.aboutEntryId,
        value,
        planItemId: pointId,
      }),
      SAVE_FAILED,
    );
    if (!created) return false;
    dispatch({ type: "merge", changes: [created] });
    return true;
  }

  async function confirmDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const removed = await run(
        deleteStudioChange({ storyId, changeId: deleting.id }),
        "The change could not be deleted.",
      );
      if (removed) {
        dispatch({ type: "remove", changeIds: [removed.changeId] });
        setDeleting(null);
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Where they are now" className="flex flex-col gap-1">
        <SectionHeading>
          Where they are now
          {sceneTitle ? (
            <span className="font-medium normal-case tracking-normal">
              {" "}
              · as of {sceneTitle}
            </span>
          ) : null}
        </SectionHeading>
        {point === null ? (
          <p className="text-label-sm text-muted-foreground/80">
            Nothing written yet.
          </p>
        ) : !tracked || tracked.aspects.length === 0 ? (
          <p className="text-label-sm text-muted-foreground/80">
            Nothing tracked yet.
          </p>
        ) : (
          <ul className="flex flex-col">
            {tracked.aspects.map((aspect) => {
              const about = aspect.aboutEntryId
                ? ` (about ${names.get(aspect.aboutEntryId) ?? "someone"})`
                : "";
              const label = `${aspect.aspect}${about}`;
              const groupKey = `${aspect.aspect}|${aspect.aboutEntryId ?? ""}`;
              if (aspect.mode === "add") {
                return (
                  <Fragment key={groupKey}>
                    {aspect.values.map((item, index) => {
                      const change = changes.find(
                        (c) => c.id === item.changeId,
                      );
                      if (!change) return null;
                      return (
                        <TrackedLine
                          editVariant="origin"
                          key={item.changeId}
                          label={label}
                          menu="delete"
                          onDelete={() => setDeleting(change)}
                          onSave={(text) => update(change, text)}
                          showLabel={index === 0}
                          value={item.value}
                        />
                      );
                    })}
                  </Fragment>
                );
              }
              const last = aspect.values.at(-1);
              const change = last
                ? changes.find((c) => c.id === last.changeId)
                : undefined;
              if (!last || !change) return null;
              return (
                <TrackedLine
                  editVariant="forward"
                  key={groupKey}
                  label={label}
                  menu="origin"
                  onDelete={() => undefined}
                  onSave={(text, variant) => {
                    if (variant === "origin") return update(change, text);
                    // Correcting again at the same beat edits the author's
                    // earlier correction instead of stacking another.
                    const ownedHere =
                      last.planItemId === point &&
                      (change.source === "author" || change.authorEdited);
                    return ownedHere
                      ? update(change, text)
                      : createFromHere(change, point, text);
                  }}
                  showLabel
                  value={last.value}
                />
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <button
          aria-expanded={showAll}
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-sm text-label-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setShowAll((open) => !open)}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform",
              showAll && "rotate-90",
            )}
          />
          Over the whole story
        </button>
        {showAll ? <OverTheStory entry={entry} /> : null}
      </div>

      <StudioConfirmDialog
        confirmLabel="Delete"
        description="This removes this one tracked value from the story. This cannot be undone."
        destructive
        loading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        open={deleting !== null}
        title="Delete this value?"
      />
    </div>
  );
}
