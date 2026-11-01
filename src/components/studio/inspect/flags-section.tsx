"use client";

import { useMemo, useRef, useState } from "react";

import { createStudioChange } from "@/actions/studio/create-studio-change";
import { resolveStudioFlag } from "@/actions/studio/resolve-studio-flag";
import { Button } from "@/components/common/button";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioFlagDto, StudioPlanItemDto } from "@/lib/studio/contracts";

import { ChangeForm, type ChangeFormValues } from "./change-form";
import { describeChange, entryNameMap } from "./inspect-labels";

type Resolution = "record" | "dismiss" | "drop";

const RESOLVE_FAILED = "The flag could not be updated.";

export function FlagsSection({ item }: { item: StudioPlanItemDto }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const loop = useWritingLoop();
  const storyId = state.story.id;
  const [editingId, setEditingId] = useState<string | null>(null);
  // Flags whose edited change already exists; a retry only dismisses.
  const recorded = useRef(new Set<string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const names = useMemo(() => entryNameMap(state.entries), [state.entries]);

  const flags = state.flags.filter(
    (flag) => flag.planItemId === item.id && flag.status === "open",
  );
  if (flags.length === 0) return null;

  async function resolve(
    flag: StudioFlagDto,
    resolution: Resolution,
  ): Promise<boolean> {
    setBusyId(flag.id);
    try {
      const result = await run(
        resolveStudioFlag({ storyId, flagId: flag.id, resolution }),
        RESOLVE_FAILED,
      );
      if (!result) return false;
      dispatch({
        type: "remove",
        changeIds: result.deletedChangeIds,
      });
      dispatch({ type: "merge", flags: result.flags, changes: result.changes });
      return true;
    } finally {
      setBusyId(null);
    }
  }

  // Edit: the author's own version is recorded as a change, then the flag
  // is dismissed because it no longer needs an answer.
  async function recordEdited(flag: StudioFlagDto, values: ChangeFormValues) {
    if (!recorded.current.has(flag.id)) {
      const created = await run(
        createStudioChange({ storyId, planItemId: flag.planItemId, ...values }),
        "The change could not be saved.",
      );
      if (!created) return false;
      recorded.current.add(flag.id);
      dispatch({ type: "merge", changes: [created] });
    }
    // If this fails the form stays open and a retry only dismisses again.
    if (!(await resolve(flag, "dismiss"))) return false;
    setEditingId(null);
    return true;
  }

  return (
    <div className="flex flex-col gap-2">
      {flags.map((flag) => {
        const payload = flag.payload;
        const busy = busyId === flag.id;
        const planned =
          payload.kind === "missing-planned-change"
            ? state.changes.find((change) => change.id === payload.changeId)
            : undefined;
        return (
          <div
            className="flex flex-col gap-2 rounded-md border border-accent/50 bg-studio-moment-highlight p-2.5 text-label-sm"
            key={flag.id}
          >
            {payload.kind === "unplanned-change" ? (
              <>
                <p className="font-semibold">
                  This moment changed more than planned.
                </p>
                <p className="text-muted-foreground">
                  In the prose: {describeChange(payload, names)}
                </p>
                {editingId === flag.id ? (
                  <ChangeForm
                    changes={state.changes}
                    entries={state.entries}
                    initial={{
                      entryId: payload.entryId,
                      aspect: payload.aspect,
                      mode: payload.mode,
                      aboutEntryId: payload.aboutEntryId,
                      value: payload.value,
                    }}
                    mode="create"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(values) => recordEdited(flag, values)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <Button
                      disabled={busy}
                      onClick={() => void resolve(flag, "record")}
                      size="sm"
                      type="button"
                    >
                      Record it
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void resolve(flag, "dismiss")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      It's fine as planned
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setEditingId(flag.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="font-semibold">Planned but not in the prose.</p>
                <p className="text-muted-foreground">
                  {planned
                    ? describeChange(planned, names)
                    : "A planned change that is no longer on this moment."}
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    disabled={busy}
                    onClick={() => void resolve(flag, "drop")}
                    size="sm"
                    type="button"
                  >
                    Drop it
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void resolve(flag, "dismiss")}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Keep anyway
                  </Button>
                  <Button
                    disabled={busy || loop.isKeeping}
                    onClick={() =>
                      void loop.write(flag.planItemId, { again: true })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Rewrite
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
