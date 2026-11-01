"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { createStudioChange } from "@/actions/studio/create-studio-change";
import { deleteStudioChange } from "@/actions/studio/delete-studio-change";
import { updateStudioChange } from "@/actions/studio/update-studio-change";
import { Button } from "@/components/common/button";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type {
  StudioChangeDto,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
import { changesComingOut } from "@/lib/studio/state";

import { ChangeForm, type ChangeFormValues } from "./change-form";
import { describeChange, entryNameMap } from "./inspect-labels";
import { InspectPill, InspectSection } from "./inspect-section";

export { ChangeForm, type ChangeFormValues } from "./change-form";

const SAVE_FAILED = "The change could not be saved.";

function isAuthored(change: StudioChangeDto): boolean {
  return change.source === "author" || change.authorEdited;
}

export function ChangesSection({ item }: { item: StudioPlanItemDto }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const storyId = state.story.id;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { changes, entries, planItems } = state;
  const names = useMemo(() => entryNameMap(entries), [entries]);
  const coming = useMemo(
    () => changesComingOut({ entries, changes, planItems }, item.id),
    [changes, entries, item.id, planItems],
  );

  async function create(values: ChangeFormValues): Promise<boolean> {
    const created = await run(
      createStudioChange({ storyId, planItemId: item.id, ...values }),
      SAVE_FAILED,
    );
    if (!created) return false;
    dispatch({ type: "merge", changes: [created] });
    setAdding(false);
    return true;
  }

  async function update(
    change: StudioChangeDto,
    values: ChangeFormValues,
  ): Promise<boolean> {
    // The entry is fixed once a record exists; changing it is a new record.
    const updated = await run(
      updateStudioChange({
        storyId,
        changeId: change.id,
        patch: {
          aspect: values.aspect,
          mode: values.mode,
          aboutEntryId: values.aboutEntryId,
          value: values.value,
        },
      }),
      SAVE_FAILED,
    );
    if (!updated) return false;
    dispatch({ type: "merge", changes: [updated] });
    setEditingId(null);
    return true;
  }

  async function remove(change: StudioChangeDto) {
    const removed = await run(
      deleteStudioChange({ storyId, changeId: change.id }),
      "The change could not be deleted.",
    );
    if (removed) dispatch({ type: "remove", changeIds: [removed.changeId] });
  }

  return (
    <InspectSection title="Changes coming out">
      {coming.length === 0 && !adding ? (
        <p className="text-caption text-muted-foreground">
          Nothing changes in this {item.kind} yet.
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {coming.map((change) =>
          editingId === change.id ? (
            <li key={change.id}>
              <ChangeForm
                changes={changes}
                entries={entries}
                initial={{
                  entryId: change.entryId,
                  aspect: change.aspect,
                  mode: change.mode,
                  aboutEntryId: change.aboutEntryId,
                  value: change.value,
                }}
                lockEntry
                mode="edit"
                onCancel={() => setEditingId(null)}
                onSubmit={(values) => update(change, values)}
              />
            </li>
          ) : (
            <li
              className="flex items-start justify-between gap-2 text-label-sm"
              key={change.id}
            >
              <div className="min-w-0">
                <p className="break-words">{describeChange(change, names)}</p>
                <div className="mt-0.5 flex gap-1">
                  <InspectPill
                    tone={change.status === "confirmed" ? "primary" : "muted"}
                  >
                    {change.status === "confirmed" ? "confirmed" : "planned"}
                  </InspectPill>
                  <InspectPill>
                    {isAuthored(change) ? "yours" : "AI"}
                  </InspectPill>
                </div>
              </div>
              <div className="flex shrink-0">
                <Button
                  aria-label="Edit change"
                  className="size-6"
                  onClick={() => {
                    setAdding(false);
                    setEditingId(change.id);
                  }}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Pencil aria-hidden="true" className="size-3" />
                </Button>
                <Button
                  aria-label="Delete change"
                  className="size-6"
                  onClick={() => void remove(change)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-3" />
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      {adding ? (
        <ChangeForm
          changes={changes}
          entries={entries}
          initial={{ entryId: item.presentEntryIds[0] }}
          mode="create"
          onCancel={() => setAdding(false)}
          onSubmit={create}
        />
      ) : (
        <Button
          className="h-6 self-start px-2 text-caption text-muted-foreground"
          disabled={entries.length === 0}
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          + add change
        </Button>
      )}
    </InspectSection>
  );
}
