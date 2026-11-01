"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { StudioProseVersionListItem } from "@/actions/studio/_types";
import { getStudioProseVersion } from "@/actions/studio/get-studio-prose-version";
import { getStudioProseVersions } from "@/actions/studio/get-studio-prose-versions";
import { mergeStudioMoment } from "@/actions/studio/merge-studio-moment";
import { restoreStudioProseVersion } from "@/actions/studio/restore-studio-prose-version";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";
import {
  flushMomentEditor,
  retryMomentSave,
  useMomentSaveState,
} from "@/components/studio/manuscript/editor-registry";
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
import { getOrderedMoments } from "@/lib/studio/plan-order";
import { markdownToPlainText } from "@/lib/studio/prose-text";

import { InspectSection } from "./inspect-section";

const ORIGIN_LABEL: Record<StudioProseOrigin, string> = {
  ai: "AI",
  "ai-edited": "edited by you",
  author: "yours",
};

const SAVE_STATE_LABEL = {
  saved: "saved",
  pending: "unsaved changes",
  saving: "saving…",
  error: "not saved",
} as const;

const FLUSH_FAILED =
  "Your edits to this moment could not be saved first, so nothing was changed.";
const REREAD_AFTER_FAILED =
  "The prose was updated, but the moment could not be re-read. Try Re-read this moment.";

export function ProseSection({ item }: { item: StudioPlanItemDto }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const proseByMoment = useProseByMomentId();
  const saveState = useMomentSaveState(item.id);
  const storyId = state.story.id;
  const prose = proseByMoment.get(item.id);
  const revision = prose?.revision ?? 0;

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<StudioProseVersionListItem[] | null>(
    null,
  );
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"restore" | "reread" | "merge" | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  // Lazy-load when opened, and refresh whenever the prose revision moves
  // (a settle snapshot, a restore, or a kept draft adds versions).
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the refresh trigger
  useEffect(() => {
    if (!versionsOpen) return;
    let cancelled = false;
    setLoadingVersions(true);
    getStudioProseVersions({ storyId, momentId: item.id })
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch(() => {
        if (!cancelled) toast.error("The saved versions could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, revision, storyId, versionsOpen]);

  const previous = useMemo(() => {
    const siblings = getOrderedMoments(state.planItems).filter(
      (moment) => moment.parentId === item.parentId,
    );
    const index = siblings.findIndex((moment) => moment.id === item.id);
    return index > 0 ? siblings[index - 1] : null;
  }, [item.id, item.parentId, state.planItems]);

  /**
   * Restore and merge replace a moment's prose wholesale, so its read-back
   * state is re-derived right away rather than waiting for the next edit.
   */
  async function rereadAfterReplace(momentId: string) {
    try {
      const patch = await readBackStudioMoment({
        storyId,
        momentId,
        force: true,
      });
      if (patch) dispatch({ type: "merge", ...patch });
    } catch (error) {
      toast.error(studioErrorMessage(error, REREAD_AFTER_FAILED));
    }
  }

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
    if (busy) return;
    setBusy("restore");
    try {
      const expectedRevision = await flushMomentEditor(item.id, revision);
      if (expectedRevision === null) {
        toast.error(FLUSH_FAILED);
        return;
      }
      const restored = await run(
        restoreStudioProseVersion({ storyId, versionId, expectedRevision }),
        "The version could not be restored.",
      );
      if (restored) {
        dispatch({ type: "merge", prose: [restored] });
        setPreview(null);
        void rereadAfterReplace(restored.momentId);
      }
    } finally {
      setBusy(null);
    }
  }

  async function reread() {
    if (busy) return;
    setBusy("reread");
    try {
      // The route reads saved prose, so land pending edits first.
      if ((await flushMomentEditor(item.id, revision)) === null) {
        toast.error(FLUSH_FAILED);
        return;
      }
      const patch = await readBackStudioMoment({
        storyId,
        momentId: item.id,
        force: true,
      });
      if (patch) dispatch({ type: "merge", ...patch });
      else toast("Nothing new to record from this moment.");
    } catch (error) {
      toast.error(
        studioErrorMessage(error, "The moment could not be re-read."),
      );
    } finally {
      setBusy(null);
    }
  }

  async function merge() {
    if (busy || !previous) return;
    setBusy("merge");
    try {
      const previousRevision = proseByMoment.get(previous.id)?.revision ?? 0;
      const expectedRevision = await flushMomentEditor(item.id, revision);
      const previousExpected = await flushMomentEditor(
        previous.id,
        previousRevision,
      );
      if (expectedRevision === null || previousExpected === null) {
        toast.error(FLUSH_FAILED);
        return;
      }
      const merged = await run(
        mergeStudioMoment({
          storyId,
          momentId: item.id,
          expectedRevision,
          previousExpectedRevision: previousExpected,
        }),
        "The moments could not be merged.",
      );
      if (!merged) return;
      setConfirmMerge(false);
      // Merge first so re-pinned changes survive the removal that follows.
      dispatch({
        type: "merge",
        prose: merged.prose,
        planItems: merged.planItems,
        changes: merged.changes,
      });
      dispatch({ type: "remove", planItemIds: merged.deletedIds });
      dispatch({ type: "select", itemId: previous.id });
      void rereadAfterReplace(previous.id);
    } finally {
      setBusy(null);
    }
  }

  const status = prose?.markdown.trim()
    ? `${ORIGIN_LABEL[prose.origin]} · ${prose.wordCount} words${
        saveState ? ` · ${SAVE_STATE_LABEL[saveState]}` : ""
      }`
    : "not written yet";

  return (
    <InspectSection meta={status} title="Prose">
      {saveState === "error" ? (
        <div className="flex items-center gap-2 text-caption text-destructive">
          This moment is not saved.
          <Button
            onClick={() => retryMomentSave(item.id)}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <Button
          aria-expanded={versionsOpen}
          onClick={() => setVersionsOpen((open) => !open)}
          size="sm"
          type="button"
          variant="outline"
        >
          Versions {versionsOpen ? "▾" : "›"}
        </Button>
        <Button
          disabled={!prose?.markdown.trim() || busy !== null}
          loading={busy === "reread"}
          onClick={() => void reread()}
          size="sm"
          type="button"
          variant="outline"
        >
          Re-read this moment
        </Button>
        <Button
          disabled={!previous || busy !== null}
          onClick={() => setConfirmMerge(true)}
          size="sm"
          title={
            previous
              ? undefined
              : "This is the first moment in its scene, so there is nothing to merge it into."
          }
          type="button"
          variant="outline"
        >
          Merge with previous
        </Button>
      </div>

      {versionsOpen ? (
        <div className="flex flex-col gap-1">
          {loadingVersions && !versions ? (
            <p className="text-caption text-muted-foreground">Loading…</p>
          ) : versions?.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              No saved versions yet. They appear as you write and keep drafts.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions?.map((version) => (
                <li className="flex flex-col gap-1" key={version.id}>
                  <div className="flex items-center justify-between gap-2 text-label-sm">
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
                        disabled={busy !== null}
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
                    <p className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-border/60 bg-card/40 p-2 font-content text-label-sm">
                      {preview.text || "This version is empty."}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <Dialog onOpenChange={setConfirmMerge} open={confirmMerge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge with the previous moment?</DialogTitle>
            <DialogDescription>
              This moment's text moves to the end of the previous moment, its
              changes follow it, and this plan item is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setConfirmMerge(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              loading={busy === "merge"}
              onClick={() => void merge()}
              type="button"
            >
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </InspectSection>
  );
}
