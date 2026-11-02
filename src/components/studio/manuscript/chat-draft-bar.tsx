"use client";

import { useState } from "react";

import { useChatSend } from "@/components/studio/ai-box/use-chat-session";
import type { BundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import {
  bundleIssueText,
  useResolveBundle,
} from "@/components/studio/bundles/use-resolve-bundle";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { isStudioBundleTempRef } from "@/lib/studio/bundle-contract";
import type { StudioPlanItemDto, StudioProseDto } from "@/lib/studio/contracts";

import type { ManuscriptProposedBeat } from "./manuscript-layout";
import { DraftBar } from "./scene-draft";
import type { BeatDraft, SceneDraft } from "./scene-draft-model";

export type ChatDrafts = {
  bundleId: string | null;
  byMomentId: Map<string, BeatDraft>;
  proposedBeats: ManuscriptProposedBeat[];
  /** Each scene's suggested beats (in plan order) and their prose op ids. */
  byScene: Map<string, { beats: BeatDraft[]; opIds: string[] }>;
};

/**
 * The chat's suggested prose as a scene draft, the same way the writing
 * loop's shows: pending prose ops on saved beats, and on beats it proposes
 * in a saved scene (placed like accept would place them).
 */
export function chatDraftsOf(
  preview: BundlePreview,
  planItems: StudioPlanItemDto[],
  proseById: Map<string, StudioProseDto>,
): ChatDrafts {
  const byId = new Map(planItems.map((item) => [item.id, item]));
  const proposedBeats: ManuscriptProposedBeat[] = [];
  for (const item of preview.proposedPlanItems) {
    const sceneId = item.parentRef;
    if (
      item.kind === "moment" &&
      sceneId &&
      !isStudioBundleTempRef(sceneId) &&
      byId.get(sceneId)?.kind === "scene"
    ) {
      proposedBeats.push({ id: item.tempId, sceneId, afterId: item.afterRef });
    }
  }
  const sceneOf = (momentId: string) =>
    isStudioBundleTempRef(momentId)
      ? proposedBeats.find((beat) => beat.id === momentId)?.sceneId
      : byId.get(momentId)?.parentId;

  const byMomentId = new Map<string, BeatDraft>();
  const byScene = new Map<string, { beats: BeatDraft[]; opIds: string[] }>();
  for (const [momentId, op] of preview.proseOpsByMomentId) {
    const sceneId = sceneOf(momentId);
    if (op.kind !== "prose.write" || !sceneId) continue;
    const beat: BeatDraft = {
      momentId,
      generationId: null,
      text: op.markdown,
      status: "ready",
      replacesProse: Boolean(proseById.get(momentId)?.markdown.trim()),
    };
    byMomentId.set(momentId, beat);
    const scene = byScene.get(sceneId) ?? { beats: [], opIds: [] };
    scene.beats.push(beat);
    scene.opIds.push(op.id);
    byScene.set(sceneId, scene);
  }
  return { bundleId: preview.bundleId, byMomentId, proposedBeats, byScene };
}

type ChatDraftBarProps = {
  bundleId: string;
  sceneId: string;
  /** Every suggested beat of the scene, in order. */
  beats: BeatDraft[];
  /** The scene's pending prose ops (all of them, across draft runs). */
  opIds: string[];
};

/**
 * The bar under the chat's suggested scene draft. Keep accepts the scene's
 * prose ops (bringing any beats they need along), Discard dismisses them,
 * and Try again asks the AI for a new draft in a follow-up message, which
 * also dismisses this one. There is no per-beat redo for a chat draft.
 */
export function ChatDraftBar({
  beats,
  bundleId,
  opIds,
  sceneId,
}: ChatDraftBarProps) {
  const { state } = useStudioStore();
  const { busy, issuesFor, resolve } = useResolveBundle();
  const send = useChatSend();
  const [keeping, setKeeping] = useState(false);
  const scene = state.planItems.find((item) => item.id === sceneId);
  const title = scene?.title.trim() || "Untitled scene";
  const draft: SceneDraft = { sceneId, beats, status: "ready" };
  const issues = [
    ...new Set(
      opIds.flatMap((opId) => issuesFor(bundleId, opId).map(bundleIssueText)),
    ),
  ];

  async function keep() {
    setKeeping(true);
    try {
      await resolve(bundleId, "accept", opIds);
    } finally {
      setKeeping(false);
    }
  }

  return (
    <DraftBar
      busy={busy}
      canKeep={opIds.length > 0}
      draft={draft}
      isKeeping={keeping}
      notice={issues.length > 0 ? issues.join(" ") : null}
      onDiscard={() => void resolve(bundleId, "reject", opIds)}
      onKeep={() => void keep()}
      onTryAgain={(note) => {
        const ask = `Rewrite your proposed draft of “${title}”.`;
        void send(note ? `${ask}\n\n${note}` : ask);
      }}
      progress={null}
      title={title}
    />
  );
}
