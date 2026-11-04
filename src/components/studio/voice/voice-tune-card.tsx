"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { applyStudioVoiceChanges } from "@/actions/studio/apply-studio-voice-changes";
import { Button } from "@/components/common/button";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  type StudioVoiceTune,
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { describeStudioVoiceOp } from "@/lib/studio/voice";
import type { StudioVoiceTunePreview } from "@/lib/studio/voice-contract";

import { useUpdateVoice } from "./use-update-voice";
import { dropVoiceTune, takeVoiceTune } from "./voice-tune-bridge";

const TUNE_FAILED = "Couldn't tune the voice.";

type TuneStatus =
  | { phase: "writing" }
  | { phase: "failed" }
  | { phase: "ready"; preview: StudioVoiceTunePreview };

/** The title of the chapter above a moment, or "this chapter". */
function useChapterLabel(momentId: string): string {
  const { state } = useStudioStore();
  const byId = new Map(state.planItems.map((item) => [item.id, item]));
  let current = byId.get(momentId);
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (current.kind === "chapter")
      return current.title.trim() || "this chapter";
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return "this chapter";
}

/**
 * A passage the author says sounds off, rewritten under the proposed voice.
 * Keep replaces the passage and applies the voice changes together.
 */
export function VoiceTuneCard({ tune }: { tune: StudioVoiceTune }) {
  const { state, dispatch } = useStudioStore();
  const runAction = useRunStudioAction();
  const updateVoice = useUpdateVoice();
  const chapter = useChapterLabel(tune.momentId);
  const storyId = state.story.id;
  const [status, setStatus] = useState<TuneStatus>(
    tune.preview
      ? { phase: "ready", preview: tune.preview }
      : { phase: "writing" },
  );
  // A finished preview survives a remount (a tab switch) in the store.
  const savedPreviewRef = useRef(tune.preview ?? null);
  savedPreviewRef.current = tune.preview ?? null;
  const [keeping, setKeeping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ phase: "writing" });
    dispatch({ type: "set-voice-tune-preview", id: tune.id, preview: null });
    try {
      const preview = await postStudioJson<StudioVoiceTunePreview>(
        "/api/studio/voice/tune",
        {
          storyId,
          momentId: tune.momentId,
          selectedText: tune.selectedText,
          complaint: tune.complaint,
        },
        controller.signal,
      );
      if (abortRef.current !== controller) return;
      setStatus({ phase: "ready", preview });
      dispatch({ type: "set-voice-tune-preview", id: tune.id, preview });
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus({ phase: "failed" });
      toast.error(studioErrorMessage(error, TUNE_FAILED));
    }
  }, [
    dispatch,
    storyId,
    tune.complaint,
    tune.id,
    tune.momentId,
    tune.selectedText,
  ]);

  useEffect(() => {
    if (!savedPreviewRef.current) void run();
    return () => abortRef.current?.abort();
  }, [run]);

  const cancel = () => {
    abortRef.current?.abort();
    dropVoiceTune(tune.id);
    dispatch({ type: "clear-voice-tune", id: tune.id });
  };

  const keep = async (preview: StudioVoiceTunePreview) => {
    if (keeping) return;
    setKeeping(true);
    // The passage is replaced first. If the voice then fails to save, the
    // new text stays and the editor's undo can reverse it.
    const entry = takeVoiceTune(tune.id);
    const replaced = entry?.replace(preview.rewrite) ?? false;
    const result = await runAction(
      applyStudioVoiceChanges({
        storyId,
        generationId: preview.generationId,
        source: "tune",
        // The action adds the "tune:" prefix itself.
        targetId: tune.momentId,
      }),
      "Couldn't update the voice.",
    );
    if (result) {
      dispatch({ type: "merge", story: result.story });
      if (preview.ops.length > 0) {
        const { undoOps } = result;
        toast("Voice updated", {
          action:
            undoOps.length > 0
              ? { label: "Undo", onClick: () => void updateVoice(undoOps) }
              : undefined,
        });
      }
    }
    // A failed apply already toasted "Couldn't update the voice.".
    if (!replaced && result) {
      toast(
        preview.ops.length > 0
          ? "The passage changed, so only the voice was updated."
          : "The passage changed, so nothing was updated.",
      );
    }
    setKeeping(false);
    dispatch({ type: "clear-voice-tune", id: tune.id });
  };

  const preview = status.phase === "ready" ? status.preview : null;
  const lines = preview
    ? preview.ops
        .map((op) => describeStudioVoiceOp(op, state.story.voice))
        .filter((line): line is string => line !== null)
    : [];

  return (
    <section
      aria-label="Tune the voice from a passage"
      className="flex flex-col gap-3 border-border border-b px-4 py-4"
    >
      <p className="text-caption text-muted-foreground">
        From {chapter}. You said: <q className="italic">{tune.complaint}</q>
      </p>
      <p className="whitespace-pre-wrap font-content text-body text-muted-foreground line-through decoration-muted-foreground/50">
        {tune.selectedText}
      </p>
      {status.phase === "writing" ? (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          Rewriting…
        </p>
      ) : null}
      {status.phase === "failed" ? (
        <p className="text-caption text-destructive">{TUNE_FAILED}</p>
      ) : null}
      {preview ? (
        <>
          <p className="whitespace-pre-wrap rounded-sm border border-studio-proposed/60 px-3 py-2 font-content text-body text-studio-proposed">
            {preview.rewrite.replace(/[*_]/g, "")}
          </p>
          {lines.length > 0 ? (
            <ul className="flex flex-col gap-1 text-caption text-foreground">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <div className="flex items-center gap-2">
        {preview ? (
          <Button
            disabled={keeping}
            onClick={() => void keep(preview)}
            size="sm"
            type="button"
          >
            Keep
          </Button>
        ) : null}
        {preview || status.phase === "failed" ? (
          <Button
            disabled={keeping}
            onClick={() => void run()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        ) : null}
        <Button
          disabled={keeping}
          onClick={cancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
      {preview ? (
        <p className="text-caption text-muted-foreground">
          Keep updates the voice for every beat from here on and replaces this
          passage. Scenes already written stay as they are.
        </p>
      ) : null}
    </section>
  );
}
