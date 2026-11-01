"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  streamStudioText,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { generateId } from "@/lib/util";

const DRAFT_FAILED = "The draft could not be written. Please try again.";
const EMPTY_DRAFT = "The draft came back empty. Try again.";
const UNSAVED_BEFORE =
  "Your latest edits could not be saved, so the draft was not started. The AI would have read older text.";

export type WritingDraft = {
  momentId: string;
  text: string;
  status: "streaming" | "ready" | "error";
  generationId: string;
  /** The author pressed Stop. A partial draft is never staged, so never kept. */
  stopped?: boolean;
};

type UseDraftStreamOptions = {
  storyId: string;
  draftRef: RefObject<WritingDraft | null>;
  commitDraft: (draft: WritingDraft | null) => void;
  /** Shared with flesh-out so one Stop aborts whichever request is running. */
  requestRef: RefObject<AbortController | null>;
  /**
   * Saves pending edits the route will read as context (the moment-prose route
   * reads prose from the database). Resolves false when a save failed.
   */
  flushBefore: (momentId: string) => Promise<boolean>;
};

/**
 * Streams one moment draft from the moment-prose route. The route stages only
 * complete text, so a stopped or failed stream leaves nothing to keep.
 */
export function useDraftStream({
  commitDraft,
  draftRef,
  flushBefore,
  requestRef,
  storyId,
}: UseDraftStreamOptions) {
  const frameRef = useRef<number | null>(null);
  const pendingTextRef = useRef("");
  /** The newest stream, so a chain can follow a Try again that replaced its own. */
  const latestStreamRef = useRef<Promise<WritingDraft | null> | null>(null);

  const cancelFrame = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  /** Resolves to the final draft, or null when a newer request superseded it. */
  const streamOnce = useCallback(
    async (
      momentId: string,
      attempt: "first" | "again",
    ): Promise<WritingDraft | null> => {
      requestRef.current?.abort();
      cancelFrame();
      const controller = new AbortController();
      requestRef.current = controller;
      const isCurrent = () => requestRef.current === controller;
      const generationId = generateId("studio-draft");
      let text = "";
      commitDraft({ momentId, generationId, text: "", status: "streaming" });

      // Deltas land once per frame so the manuscript does not re-render per token.
      const scheduleText = () => {
        pendingTextRef.current = text;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const current = draftRef.current;
          if (
            current?.generationId === generationId &&
            current.status === "streaming"
          ) {
            commitDraft({ ...current, text: pendingTextRef.current });
          }
        });
      };

      const finish = (
        status: WritingDraft["status"],
        stopped?: boolean,
      ): WritingDraft => {
        const final: WritingDraft = {
          momentId,
          generationId,
          text,
          status,
          ...(stopped ? { stopped } : {}),
        };
        commitDraft(final);
        return final;
      };

      // Something else took the request slot (a newer stream, flesh-out, or
      // Discard). A newer stream or Discard already replaced this draft; if it
      // is still on screen, settle it so it never sits at "Writing…".
      const settleSuperseded = (status: WritingDraft["status"]) => {
        const current = draftRef.current;
        if (
          current?.generationId !== generationId ||
          current.status !== "streaming"
        ) {
          return null;
        }
        cancelFrame();
        finish(status, status === "error");
        return null;
      };

      try {
        const flushed = await flushBefore(momentId);
        if (!isCurrent()) return settleSuperseded("error");
        if (controller.signal.aborted) return finish("error", true);
        if (!flushed) {
          toast.error(UNSAVED_BEFORE);
          return finish("error");
        }
        await streamStudioText(
          "/api/studio/moment-prose",
          { storyId, momentId, generationId, attempt },
          {
            signal: controller.signal,
            onDelta: (delta) => {
              if (!isCurrent()) return;
              text += delta;
              scheduleText();
            },
          },
        );
        // The route staged complete text, so a superseded draft stays keepable.
        if (!isCurrent()) {
          return settleSuperseded(text.trim() ? "ready" : "error");
        }
        cancelFrame();
        if (!text.trim()) {
          toast.error(EMPTY_DRAFT);
          return finish("error");
        }
        return finish("ready");
      } catch (error) {
        if (!isCurrent()) return settleSuperseded("error");
        cancelFrame();
        const stopped = controller.signal.aborted;
        // A user stop is silent; anything else toasts a sanitized message.
        if (!stopped) toast.error(studioErrorMessage(error, DRAFT_FAILED));
        return finish("error", stopped);
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    },
    [cancelFrame, commitDraft, draftRef, flushBefore, requestRef, storyId],
  );

  const stream = useCallback(
    (momentId: string, attempt: "first" | "again") => {
      const pending = streamOnce(momentId, attempt);
      latestStreamRef.current = pending;
      return pending;
    },
    [streamOnce],
  );

  const getLatestStream = useCallback(() => latestStreamRef.current, []);

  return { cancelFrame, getLatestStream, stream };
}
