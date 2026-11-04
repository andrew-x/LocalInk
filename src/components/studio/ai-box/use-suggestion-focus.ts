"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import {
  type BundlePreview,
  useBundlePreview,
} from "@/components/studio/bundles/use-bundle-preview";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { studioOutlineLineId } from "@/components/studio/workspace/workspace-anchors";
import {
  isStudioBundleTempRef,
  type StudioBundleOpDto,
} from "@/lib/studio/bundle-contract";

import { revealElement, suggestionAnchorId } from "./suggestion-controls";
import { useChatSession } from "./use-chat-session";

type Place =
  /** Open this saved line (or nothing, for a new chapter) and reveal the op. */
  | { kind: "outline"; selectId: string | null }
  | { kind: "entry"; entryId: string | null }
  | { kind: "voice" }
  | { kind: "manuscript" }
  | { kind: "conversation" };

/** The first saved item a proposed line nests under, or null (a chapter). */
function savedAncestor(preview: BundlePreview, ref: string | null) {
  const seen = new Set<string>();
  let current = ref;
  while (current && isStudioBundleTempRef(current) && !seen.has(current)) {
    seen.add(current);
    const parent = preview.proposedPlanItems.find(
      (item) => item.tempId === current,
    );
    current = parent?.parentRef ?? null;
  }
  return current && !isStudioBundleTempRef(current) ? current : null;
}

/** Where an op shows in place; only pending ops of the previewed bundle do. */
function placeOf(
  op: StudioBundleOpDto,
  bundleId: string,
  preview: BundlePreview,
): Place {
  if (
    op.status !== "pending" ||
    preview.bundleId !== bundleId ||
    preview.otherOps.some((other) => other.id === op.id)
  ) {
    return { kind: "conversation" };
  }
  switch (op.kind) {
    case "plan.create": {
      const item = preview.proposedPlanItems.find((p) => p.opId === op.id);
      return {
        kind: "outline",
        selectId: savedAncestor(preview, item?.parentRef ?? null),
      };
    }
    case "plan.update":
    case "plan.move":
    case "plan.delete":
      return { kind: "outline", selectId: op.itemId };
    case "entry.create":
      return { kind: "entry", entryId: null };
    case "entry.update":
    case "entry.delete":
      return { kind: "entry", entryId: op.entryId };
    case "story.update":
      return { kind: "voice" };
    case "prose.write":
      return { kind: "manuscript" };
    default:
      return { kind: "conversation" };
  }
}

/**
 * Routes `focusBundleOp` (the bar's count, an op's "Show where") to where
 * the op shows: plan ops open their outline line, entry ops their entry,
 * prose ops scroll the manuscript to the draft. Anything else opens the
 * conversation at the op's row, switching to its thread when it is idle.
 */
export function useSuggestionFocus() {
  const { state, dispatch } = useStudioStore();
  const preview = useBundlePreview();
  const session = useChatSession();
  const handledNonce = useRef(0);
  const latest = useRef({ preview, session, state });
  useEffect(() => {
    latest.current = { preview, session, state };
  });

  const nonce = state.bundleFocusNonce;
  useEffect(() => {
    if (nonce === 0 || handledNonce.current === nonce) return;
    handledNonce.current = nonce;
    const { preview, session, state } = latest.current;
    const focus = state.focusedBundleOp;
    dispatch({ type: "clearBundleFocus" });
    if (!focus) return;
    const bundle =
      state.bundles.find((b) => b.id === focus.bundleId) ??
      session.bundleById.get(focus.bundleId);
    const op = bundle?.operations.find(
      (candidate) => candidate.id === focus.opId,
    );
    if (!bundle || !op) return;

    const anchor = suggestionAnchorId(bundle.id, op.id);
    const place = placeOf(op, bundle.id, preview);
    switch (place.kind) {
      case "outline":
        session.setConversationOpen(false);
        dispatch({ type: "setPlanTab", tab: "outline" });
        // The outline follows a selection: it opens the line's chapter or
        // scene card, and the reveal waits for it to render.
        if (place.selectId) {
          dispatch({ type: "select", itemId: place.selectId });
        }
        // The outline does not follow while the author has unsaved edits
        // there; the line itself is the fallback.
        revealElement(
          anchor,
          6,
          place.selectId ? studioOutlineLineId(place.selectId) : undefined,
        );
        return;
      case "entry":
        session.setConversationOpen(false);
        if (place.entryId) {
          dispatch({ type: "openEntry", entryId: place.entryId });
        } else {
          dispatch({ type: "setPlanTab", tab: "characters" });
        }
        revealElement(anchor, 6);
        return;
      case "voice":
        session.setConversationOpen(false);
        dispatch({ type: "setPlanTab", tab: "voice" });
        revealElement(anchor, 6);
        return;
      case "manuscript":
        revealElement(anchor, 6);
        return;
      case "conversation": {
        const threadId = bundle.threadId;
        if (threadId && threadId !== session.activeThreadId) {
          const status = session.turn.getStatus();
          if (status !== "idle" && status !== "save-failed") {
            toast.info(
              "That suggestion is in another conversation. Try again once this reply finishes.",
            );
            return;
          }
          session.openThread(threadId);
        }
        session.showOpInConversation(bundle.id, op.id);
      }
    }
  }, [dispatch, nonce]);
}
