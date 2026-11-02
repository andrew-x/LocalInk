"use client";

import { useMemo, useState } from "react";

import { resolveStudioFlag } from "@/actions/studio/resolve-studio-flag";
import { Button } from "@/components/common/button";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import {
  describeChange,
  entryNameMap,
} from "@/components/studio/shared/inspect-labels";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioFlagDto } from "@/lib/studio/contracts";
import type { StudioPlanNode } from "@/lib/studio/plan-order";

type Resolution = "record" | "dismiss" | "drop";

const RESOLVE_FAILED = "The note could not be updated.";

/**
 * One compact amber note per open flag on the scene's beats, in plain words.
 * Read-back raises them; the author answers here.
 */
export function FlagNotes({ scene }: { scene: StudioPlanNode }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const loop = useWritingLoop();
  const storyId = state.story.id;
  const [busyId, setBusyId] = useState<string | null>(null);
  const names = useMemo(() => entryNameMap(state.entries), [state.entries]);

  // Flags hang on beats; a scene-level one (if any) comes first.
  const beatNumbers = new Map(
    scene.children.map((beat, index) => [beat.id, index + 1]),
  );
  const flags = state.flags
    .filter(
      (flag) =>
        flag.status === "open" &&
        (flag.planItemId === scene.id || beatNumbers.has(flag.planItemId)),
    )
    .sort(
      (a, b) =>
        (beatNumbers.get(a.planItemId) ?? 0) -
          (beatNumbers.get(b.planItemId) ?? 0) ||
        (a.createdAt < b.createdAt ? -1 : 1),
    );
  if (flags.length === 0) return null;

  async function resolve(flag: StudioFlagDto, resolution: Resolution) {
    setBusyId(flag.id);
    try {
      const result = await run(
        resolveStudioFlag({ storyId, flagId: flag.id, resolution }),
        RESOLVE_FAILED,
      );
      if (!result) return;
      dispatch({ type: "remove", changeIds: result.deletedChangeIds });
      dispatch({ type: "merge", flags: result.flags, changes: result.changes });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ul aria-label="Things to check" className="flex flex-col gap-1.5">
      {flags.map((flag) => {
        const payload = flag.payload;
        const busy = busyId === flag.id;
        const beat = beatNumbers.get(flag.planItemId);
        const where = beat ? `Beat ${beat} · ` : "";
        const planned =
          payload.kind === "missing-planned-change"
            ? state.changes.find((change) => change.id === payload.changeId)
            : undefined;
        return (
          <li
            className="flex flex-col gap-1 rounded-md border border-studio-moment-edge/40 bg-studio-moment-highlight px-2 py-1.5 text-caption"
            key={flag.id}
          >
            {payload.kind === "unplanned-change" ? (
              <>
                <p>
                  <span className="text-accent">
                    {where}In the prose, but not planned.
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {describeChange(payload, names)}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1">
                  <NoteButton
                    disabled={busy}
                    onClick={() => void resolve(flag, "record")}
                  >
                    Keep it
                  </NoteButton>
                  <NoteButton
                    disabled={busy}
                    onClick={() => void resolve(flag, "dismiss")}
                  >
                    It's fine
                  </NoteButton>
                </div>
              </>
            ) : (
              <>
                <p>
                  <span className="text-accent">
                    {where}Planned, but not in the prose.
                  </span>{" "}
                  <span className="text-muted-foreground">
                    {planned
                      ? describeChange(planned, names)
                      : "A planned change that is no longer on this beat."}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1">
                  <NoteButton
                    disabled={busy}
                    onClick={() => void resolve(flag, "drop")}
                  >
                    Drop it
                  </NoteButton>
                  <NoteButton
                    disabled={busy}
                    onClick={() => void resolve(flag, "dismiss")}
                  >
                    Keep anyway
                  </NoteButton>
                  {/* Temporary until Task 9 redrafts the whole scene. */}
                  <NoteButton
                    disabled={busy || loop.isKeeping}
                    onClick={() =>
                      void loop.write(flag.planItemId, { again: true })
                    }
                  >
                    Rewrite
                  </NoteButton>
                </div>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NoteButton({
  children,
  disabled,
  onClick,
}: {
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-6 px-2 text-caption"
      disabled={disabled}
      onClick={onClick}
      size="sm"
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  );
}
