"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  streamStudioText,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import type { StudioMomentProseRequest } from "@/lib/studio/moment-contract";
import { generateId } from "@/lib/util";

const DRAFT_FAILED = "The draft could not be written. Please try again.";
const EMPTY_DRAFT = "The draft came back empty. Try again.";
const UNSAVED_BEFORE =
  "Your latest edits could not be saved, so the draft was not started. The AI would have read older text.";

export type DraftStreamOptions = {
  attempt: "first" | "again";
  /** Earlier unkept beats of the same scene, by staged id. */
  precedingDrafts: { momentId: string; generationId: string }[];
  /** The author's one-off direction for this pass, or null. */
  note: string | null;
};

export type DraftStreamResult = {
  generationId: string;
  text: string;
  status: "ready" | "error";
  /** Aborted while still current. A partial draft is never staged. */
  stopped?: boolean;
};

type UseDraftStreamOptions = {
  storyId: string;
  /** Shared with flesh-out so one Stop or Discard aborts whichever request runs. */
  requestRef: RefObject<AbortController | null>;
  /**
   * Saves pending edits the route will read as context (the moment-prose route
   * reads prose from the database). Resolves false when a save failed.
   */
  flushBefore: (momentId: string) => Promise<boolean>;
  /** Streamed text so far, at most once per frame. */
  onProgress: (momentId: string, generationId: string, text: string) => void;
};

/**
 * Streams one beat draft from the moment-prose route. The route stages only
 * complete text, so a stopped or failed stream leaves nothing to keep.
 */
export function useDraftStream({
  flushBefore,
  onProgress,
  requestRef,
  storyId,
}: UseDraftStreamOptions) {
  const frameRef = useRef<number | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  /**
   * Resolves to the beat's final text, or null when something else took the
   * request slot (Stop, Discard, a newer stream, or planning).
   */
  const stream = useCallback(
    async (
      momentId: string,
      { attempt, note, precedingDrafts }: DraftStreamOptions,
    ): Promise<DraftStreamResult | null> => {
      requestRef.current?.abort();
      cancelFrame();
      const controller = new AbortController();
      requestRef.current = controller;
      const isCurrent = () => requestRef.current === controller;
      const generationId = generateId("studio-draft");
      let text = "";

      // Deltas land once per frame so the manuscript does not re-render per token.
      const scheduleText = () => {
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          if (isCurrent()) onProgress(momentId, generationId, text);
        });
      };

      try {
        const flushed = await flushBefore(momentId);
        if (!isCurrent()) return null;
        if (controller.signal.aborted) {
          return { generationId, text, status: "error", stopped: true };
        }
        if (!flushed) {
          toast.error(UNSAVED_BEFORE);
          return { generationId, text, status: "error" };
        }
        const body: StudioMomentProseRequest = {
          storyId,
          momentId,
          generationId,
          attempt,
          precedingDrafts,
          note: note?.trim() || null,
        };
        await streamStudioText("/api/studio/moment-prose", body, {
          signal: controller.signal,
          onDelta: (delta) => {
            if (!isCurrent()) return;
            text += delta;
            scheduleText();
          },
        });
        if (!isCurrent()) return null;
        cancelFrame();
        if (!text.trim()) {
          toast.error(EMPTY_DRAFT);
          return { generationId, text, status: "error" };
        }
        return { generationId, text, status: "ready" };
      } catch (error) {
        if (!isCurrent()) return null;
        cancelFrame();
        const stopped = controller.signal.aborted;
        // A stop is silent. Anything else, including an expired earlier beat
        // (409 DRAFT_EXPIRED), toasts the route's sanitized message.
        if (!stopped) toast.error(studioErrorMessage(error, DRAFT_FAILED));
        return {
          generationId,
          text,
          status: "error",
          ...(stopped ? { stopped } : {}),
        };
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [cancelFrame, flushBefore, onProgress, requestRef, storyId],
  );

  return { cancelFrame, stream };
}
