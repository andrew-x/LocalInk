"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { StudioProseVersionListItem } from "@/actions/studio/_types";
import { getStudioProseVersion } from "@/actions/studio/get-studio-prose-version";
import { getStudioProseVersions } from "@/actions/studio/get-studio-prose-versions";
import { restoreStudioProseVersion } from "@/actions/studio/restore-studio-prose-version";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/common/dialog";
import { flushMomentEditor } from "@/components/studio/manuscript/editor-registry";
import { readBackStudioMoment } from "@/components/studio/manuscript/read-back-client";
import { studioErrorMessage } from "@/components/studio/studio-fetch";
import {
  useProseByMomentId,
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import day from "@/lib/dayjs";
import type {
  StudioPlanItemDto,
  StudioProseOrigin,
} from "@/lib/studio/contracts";
import type { StudioPlanNode } from "@/lib/studio/plan-order";
import { markdownToPlainText } from "@/lib/studio/prose-text";
import { cn } from "@/lib/util";

const ORIGIN_LABEL: Record<StudioProseOrigin, string> = {
  ai: "AI",
  "ai-edited": "edited by you",
  author: "yours",
};

const FLUSH_FAILED =
  "Your edits to this beat could not be saved first, so nothing was changed.";
const REREAD_AFTER_FAILED =
  "The prose was restored, but the beat could not be re-read. Try Re-read.";

type BeatVersionsDialogProps = {
  scene: StudioPlanNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Saved versions of each beat's prose, with preview and restore. */
export function BeatVersionsDialog({
  scene,
  open,
  onOpenChange,
}: BeatVersionsDialogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sceneTitle = scene.title.trim() || "Untitled scene";

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) setExpandedId(null);
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[80dvh] max-w-xl flex-col gap-0 p-0 sm:max-w-xl">
        <div className="flex min-h-12 shrink-0 flex-col justify-center border-border/80 border-b px-5 py-3 pr-12">
          <DialogTitle className="font-serif text-heading">
            Versions · {sceneTitle}
          </DialogTitle>
          <DialogDescription className="text-caption">
            Each beat keeps its earlier prose. Restoring saves the current text
            as a version first.
          </DialogDescription>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {scene.children.length === 0 ? (
            <li className="px-2 py-1 text-caption text-muted-foreground">
              This scene has no beats yet.
            </li>
          ) : null}
          {scene.children.map((beat, index) => (
            <BeatVersions
              beat={beat}
              expanded={expandedId === beat.id}
              key={beat.id}
              number={index + 1}
              onToggle={() =>
                setExpandedId((current) =>
                  current === beat.id ? null : beat.id,
                )
              }
            />
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function BeatVersions({
  beat,
  expanded,
  number,
  onToggle,
}: {
  beat: StudioPlanItemDto;
  expanded: boolean;
  number: number;
  onToggle: () => void;
}) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const proseByMoment = useProseByMomentId();
  const storyId = state.story.id;
  const prose = proseByMoment.get(beat.id);
  const revision = prose?.revision ?? 0;
  const [versions, setVersions] = useState<StudioProseVersionListItem[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [restoring, setRestoring] = useState(false);

  // Lazy-load when expanded, and refresh whenever the prose revision moves
  // (a settle snapshot, a restore, or a kept draft adds versions).
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the refresh trigger
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoading(true);
    getStudioProseVersions({ storyId, momentId: beat.id })
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch(() => {
        if (!cancelled) toast.error("The saved versions could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [beat.id, expanded, revision, storyId]);

  async function showPreview(versionId: string) {
    if (preview?.id === versionId) {
      setPreview(null);
      return;
    }
    try {
      const version = await getStudioProseVersion({ storyId, versionId });
      setPreview({
        id: versionId,
        text: markdownToPlainText(version.markdown),
      });
    } catch {
      toast.error("The saved version could not be loaded.");
    }
  }

  async function restore(versionId: string) {
    if (restoring) return;
    setRestoring(true);
    try {
      // Land pending manuscript edits so they become a version, not a conflict.
      const expectedRevision = await flushMomentEditor(beat.id, revision);
      if (expectedRevision === null) {
        toast.error(FLUSH_FAILED);
        return;
      }
      const restored = await run(
        restoreStudioProseVersion({ storyId, versionId, expectedRevision }),
        "The version could not be restored.",
      );
      if (!restored) return;
      dispatch({ type: "merge", prose: [restored] });
      setPreview(null);
      // The prose was replaced wholesale, so re-derive its read-back now.
      try {
        const patch = await readBackStudioMoment({
          storyId,
          momentId: restored.momentId,
          force: true,
        });
        if (patch) dispatch({ type: "merge", ...patch });
      } catch (error) {
        toast.error(studioErrorMessage(error, REREAD_AFTER_FAILED));
      }
    } finally {
      setRestoring(false);
    }
  }

  const words = prose?.markdown.trim() ? prose.wordCount : 0;

  return (
    <li className="flex flex-col">
      <button
        aria-expanded={expanded}
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-label-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={onToggle}
        type="button"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="shrink-0">Beat {number}</span>
        <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
          {beat.whatHappens}
        </span>
        <span className="shrink-0 font-normal text-caption text-muted-foreground">
          {words > 0 ? `${words} words` : "not written"}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-1 py-1 pr-2 pl-7">
          {loading && !versions ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : versions?.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              No saved versions yet. They appear as you write and keep drafts.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions?.map((version) => (
                <li className="flex flex-col gap-1" key={version.id}>
                  <div className="flex items-center justify-between gap-2 text-caption">
                    <span className="min-w-0 truncate">
                      {day(version.createdAt).format("MMM D, h:mm A")}
                      <span className="text-muted-foreground">
                        {" · "}
                        {ORIGIN_LABEL[version.origin]} · {version.wordCount}{" "}
                        words
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        className="h-6 px-2 text-caption"
                        onClick={() => void showPreview(version.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {preview?.id === version.id ? "Hide" : "Preview"}
                      </Button>
                      <Button
                        className="h-6 px-2 text-caption"
                        disabled={restoring}
                        onClick={() => void restore(version.id)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Restore
                      </Button>
                    </span>
                  </div>
                  {preview?.id === version.id ? (
                    <p className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-border/60 bg-card/40 p-2 font-content text-label-sm font-normal">
                      {preview.text || "This version is empty."}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
