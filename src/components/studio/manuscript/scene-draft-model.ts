import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { getOrderedMoments } from "@/lib/studio/plan-order";

/** One beat of a scene draft. `generationId` is the staged draft once ready. */
export type BeatDraft = {
  momentId: string;
  generationId: string | null;
  text: string;
  status: "queued" | "streaming" | "ready" | "error";
  /** The beat already has prose; Keep replaces it (the old text stays in versions). */
  replacesProse: boolean;
};

export type SceneDraft = {
  sceneId: string;
  beats: BeatDraft[];
  status: "planning" | "streaming" | "ready" | "stopped" | "error";
  /**
   * The server refused the last Keep (an expired stage, a stale revision, or
   * a transient failure; the client cannot tell which). Cleared by any new stream.
   */
  keepRefused?: boolean;
};

/** Keep needs every beat staged: a stopped, failed or queued beat has nothing to keep. */
export function isSceneDraftKeepable(draft: SceneDraft | null): boolean {
  return (
    draft !== null &&
    draft.status === "ready" &&
    draft.beats.length > 0 &&
    draft.beats.every(
      (beat) => beat.status === "ready" && beat.generationId !== null,
    )
  );
}

/** Planning or streaming: Stop applies, Keep / Try again / Redo wait. */
export function isSceneDraftRunning(draft: SceneDraft | null): boolean {
  return draft?.status === "planning" || draft?.status === "streaming";
}

/** The draft's beats in current plan order (the author may reorder mid-draft). */
export function orderedDraftBeats(
  draft: SceneDraft,
  planItems: StudioPlanItemDto[],
): BeatDraft[] {
  const position = new Map(
    getOrderedMoments(planItems).map((moment, index) => [moment.id, index]),
  );
  // Beats not in the plan yet (a store update still on its way) keep draft order.
  const at = (momentId: string) =>
    position.get(momentId) ?? Number.MAX_SAFE_INTEGER;
  return [...draft.beats].sort((a, b) => at(a.momentId) - at(b.momentId));
}

/**
 * The staged ids of the ready beats before `momentId`, in plan order. The
 * route reads their text from staging, so the beat is drafted against the
 * earlier beats as the author will read them, not against stale saved prose.
 */
export function precedingDraftsFor(
  draft: SceneDraft,
  momentId: string,
  planItems: StudioPlanItemDto[],
): { momentId: string; generationId: string }[] {
  const ordered = orderedDraftBeats(draft, planItems);
  const index = ordered.findIndex((beat) => beat.momentId === momentId);
  return ordered
    .slice(0, Math.max(0, index))
    .flatMap((beat) =>
      beat.status === "ready" && beat.generationId
        ? [{ momentId: beat.momentId, generationId: beat.generationId }]
        : [],
    );
}

export function withBeat(
  draft: SceneDraft,
  momentId: string,
  patch: Partial<Omit<BeatDraft, "momentId">>,
): SceneDraft {
  return {
    ...draft,
    beats: draft.beats.map((beat) =>
      beat.momentId === momentId ? { ...beat, ...patch } : beat,
    ),
  };
}

/** Clears beats that are about to be written again. */
export function withBeatsQueued(
  draft: SceneDraft,
  momentIds: ReadonlySet<string>,
): SceneDraft {
  return {
    ...draft,
    status: "streaming",
    beats: draft.beats.map((beat) =>
      momentIds.has(beat.momentId)
        ? { ...beat, status: "queued", text: "", generationId: null }
        : beat,
    ),
  };
}

/** A draft whose scene or beats were deleted (or moved away) can never be kept. */
export function isSceneDraftOrphaned(
  draft: SceneDraft,
  planItems: StudioPlanItemDto[],
): boolean {
  const byId = new Map(planItems.map((item) => [item.id, item]));
  if (byId.get(draft.sceneId)?.kind !== "scene") return true;
  return draft.beats.some((beat) => {
    const item = byId.get(beat.momentId);
    return item?.kind !== "moment" || item.parentId !== draft.sceneId;
  });
}
