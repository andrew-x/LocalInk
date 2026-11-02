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
  /**
   * The earlier unkept beats (moment ids) this beat was drafted against, set
   * when it starts streaming. Dropping one of them makes this beat stale.
   */
  basedOn?: string[];
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

/**
 * The draft's beats whose plan item was deleted or moved out of its scene, or
 * "scene" when the scene itself is gone (then nothing can be kept).
 */
export function orphanedDraftBeats(
  draft: SceneDraft,
  planItems: StudioPlanItemDto[],
): ReadonlySet<string> | "scene" {
  const byId = new Map(planItems.map((item) => [item.id, item]));
  if (byId.get(draft.sceneId)?.kind !== "scene") return "scene";
  return new Set(
    draft.beats
      .filter((beat) => {
        const item = byId.get(beat.momentId);
        return item?.kind !== "moment" || item.parentId !== draft.sceneId;
      })
      .map((beat) => beat.momentId),
  );
}

export type DroppedDraftBeats = {
  /** The draft without the dropped beats; stale ready beats need a redo. */
  draft: SceneDraft;
  /** The streaming beat was dropped, or was drafted against a dropped beat. */
  streamAffected: boolean;
  /** A ready beat was drafted against a dropped beat and now needs a redo. */
  invalidated: boolean;
};

/**
 * Removes `dropped` beats from the draft. A ready beat drafted against one
 * of them is marked as needing a redo (error, nothing staged to keep), so
 * Keep waits until it is redone. The draft's status is left to the caller.
 */
export function dropDraftBeats(
  draft: SceneDraft,
  dropped: ReadonlySet<string>,
): DroppedDraftBeats {
  let streamAffected = false;
  let invalidated = false;
  const beats = draft.beats.flatMap((beat): BeatDraft[] => {
    if (dropped.has(beat.momentId)) {
      if (beat.status === "streaming") streamAffected = true;
      return [];
    }
    if (!beat.basedOn?.some((id) => dropped.has(id))) return [beat];
    if (beat.status === "streaming") {
      streamAffected = true;
      return [beat];
    }
    if (beat.status === "ready") {
      invalidated = true;
      return [{ ...beat, status: "error", generationId: null }];
    }
    return [beat];
  });
  return { draft: { ...draft, beats }, streamAffected, invalidated };
}

/**
 * Settles a draft that is not running after beats left it. It is ready only
 * when every beat is (Keep's rule); otherwise it stays stopped or failed. When
 * the beat that failed was the one dropped, the first queued beat takes its
 * place, so its Redo picks the chain up from there.
 */
export function settleDraft(
  draft: SceneDraft,
  planItems: StudioPlanItemDto[],
): SceneDraft {
  if (draft.beats.every((beat) => beat.status === "ready")) {
    return { ...draft, status: "ready" };
  }
  const status = draft.status === "ready" ? "error" : draft.status;
  if (draft.beats.some((beat) => beat.status === "error")) {
    return { ...draft, status };
  }
  const firstQueued = orderedDraftBeats(draft, planItems).find(
    (beat) => beat.status === "queued",
  );
  return firstQueued
    ? withBeat({ ...draft, status }, firstQueued.momentId, { status: "error" })
    : { ...draft, status };
}
