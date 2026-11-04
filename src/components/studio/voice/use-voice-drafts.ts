"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { keepStudioVoiceSample } from "@/actions/studio/keep-studio-voice-sample";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioVoiceSamplePreview } from "@/lib/studio/voice-contract";

export type VoiceDraft = {
  status: "writing" | "ready" | "failed";
  generationId?: string;
  text?: string;
  planItemId?: string | null;
  /** What the author was looking at before this rewrite. */
  previousText?: string;
  /** What changed, for "Rewritten for ...". */
  changedLabel?: string;
};

export type VoiceDraftReason = { previousText?: string; changedLabel?: string };

export type VoiceDrafts = {
  drafts: Record<string, VoiceDraft>;
  write(
    kind: string,
    planItemId: string | null,
    reason?: VoiceDraftReason,
  ): void;
  keep(kind: string): Promise<boolean>;
  clear(kind: string): void;
};

/** Kinds are case-insensitive; drafts are keyed by the lowercased kind. */
export function voiceKey(kind: string): string {
  return kind.trim().toLowerCase();
}

/**
 * Unkept sample drafts, one per kind of moment, held in component state. The
 * text only ever comes from the sample route; Keep sends the generation id.
 * Writing a kind again aborts its earlier request, so the newest wins.
 */
export function useVoiceDrafts(): VoiceDrafts {
  const { state, dispatch } = useStudioStore();
  const runAction = useRunStudioAction();
  const storyId = state.story.id;
  const [drafts, setDrafts] = useState<Record<string, VoiceDraft>>({});
  const draftsRef = useRef(drafts);
  const inflight = useRef(new Map<string, AbortController>());

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    const requests = inflight.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
      requests.clear();
    };
  }, []);

  const write = useCallback(
    (kind: string, planItemId: string | null, reason?: VoiceDraftReason) => {
      const key = voiceKey(kind);
      inflight.current.get(key)?.abort();
      const controller = new AbortController();
      inflight.current.set(key, controller);
      setDrafts((prev) => ({
        ...prev,
        [key]: {
          status: "writing",
          planItemId,
          previousText: reason?.previousText,
          changedLabel: reason?.changedLabel,
        },
      }));

      void (async () => {
        try {
          const preview = await postStudioJson<StudioVoiceSamplePreview>(
            "/api/studio/voice/sample",
            { storyId, kind, planItemId },
            controller.signal,
          );
          if (inflight.current.get(key) !== controller) return;
          inflight.current.delete(key);
          setDrafts((prev) => ({
            ...prev,
            [key]: {
              status: "ready",
              generationId: preview.generationId,
              text: preview.text,
              planItemId: preview.planItemId,
              previousText: reason?.previousText,
              changedLabel: reason?.changedLabel,
            },
          }));
        } catch (error) {
          if (inflight.current.get(key) !== controller) return;
          inflight.current.delete(key);
          toast.error(studioErrorMessage(error, "Couldn't write this sample."));
          setDrafts((prev) => ({
            ...prev,
            [key]: { status: "failed", planItemId },
          }));
        }
      })();
    },
    [storyId],
  );

  const clear = useCallback((kind: string) => {
    const key = voiceKey(kind);
    inflight.current.get(key)?.abort();
    inflight.current.delete(key);
    setDrafts((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const keep = useCallback(
    async (kind: string): Promise<boolean> => {
      const draft = draftsRef.current[voiceKey(kind)];
      if (draft?.status !== "ready" || !draft.generationId) return false;
      const story = await runAction(
        keepStudioVoiceSample({
          storyId,
          kind,
          generationId: draft.generationId,
        }),
        "Couldn't keep this sample.",
      );
      if (!story) return false;
      dispatch({ type: "merge", story });
      // A newer rewrite that started meanwhile stays.
      if (
        draftsRef.current[voiceKey(kind)]?.generationId === draft.generationId
      ) {
        clear(kind);
      }
      return true;
    },
    [clear, dispatch, runAction, storyId],
  );

  return { drafts, write, keep, clear };
}
