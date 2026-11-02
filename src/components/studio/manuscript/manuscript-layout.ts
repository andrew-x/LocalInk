import type { StudioPlanItemDto, StudioProseDto } from "@/lib/studio/contracts";
import { buildPlanTree, type StudioPlanNode } from "@/lib/studio/plan-order";

import type { BeatDraft } from "./scene-draft-model";

type Placement = { sceneId: string; chapterId: string; sceneStart: boolean };

export type ManuscriptDraftBeat = {
  /** A saved moment, or a proposed beat's temp id (chat drafts only). */
  momentId: string;
  draft: BeatDraft;
};

/** Whose draft a block shows: the writing loop's, or the AI box's suggestion. */
export type ManuscriptDraftSource = "loop" | "chat";

/** A beat the chat proposed in a saved scene, placed like accept would. */
export type ManuscriptProposedBeat = {
  /** The beat's temp id. */
  id: string;
  sceneId: string;
  /** The beat it follows (saved or temp id), or null to append. */
  afterId: string | null;
};

export type ManuscriptBlock =
  | { type: "chapter"; chapter: StudioPlanItemDto; number: number }
  | { type: "break"; sceneId: string; chapterId: string }
  | ({ type: "moment"; moment: StudioPlanItemDto } & Placement)
  | ({
      /** Consecutive draft beats of one scene, shown in place of their prose. */
      type: "draft";
      source: ManuscriptDraftSource;
      beats: ManuscriptDraftBeat[];
      /**
       * The scene's last run of this source's draft: its Keep / Try again /
       * Discard bar follows it.
       */
      endsDraft: boolean;
    } & Placement);

export type ManuscriptLayout = {
  blocks: ManuscriptBlock[];
  /** The scene the closing "Up next" line offers to write, if any. */
  upNext: { sceneId: string } | null;
  chapterCount: number;
  sceneCount: number;
};

type SceneEntry = {
  scene: StudioPlanNode;
  chapterId: string;
  moments: StudioPlanNode[];
};

function stripNode(node: StudioPlanNode): StudioPlanItemDto {
  const { children: _children, ...item } = node;
  return item;
}

function sceneEntries(planItems: StudioPlanItemDto[]): {
  chapters: StudioPlanNode[];
  scenes: SceneEntry[];
} {
  const chapters = buildPlanTree(planItems).filter(
    (node) => node.kind === "chapter",
  );
  const scenes = chapters.flatMap((chapter) =>
    chapter.children
      .filter((child) => child.kind === "scene")
      .map((scene) => ({
        scene,
        chapterId: chapter.id,
        moments: scene.children.filter((child) => child.kind === "moment"),
      })),
  );
  return { chapters, scenes };
}

/** Beat ids in order, with proposed beats inserted after their `afterId`. */
export function withProposedBeats(
  ids: string[],
  proposed: readonly ManuscriptProposedBeat[],
): string[] {
  const ordered = [...ids];
  for (const beat of proposed) {
    const index = beat.afterId === null ? -1 : ordered.indexOf(beat.afterId);
    if (index < 0) ordered.push(beat.id);
    else ordered.splice(index + 1, 0, beat.id);
  }
  return ordered;
}

function hasProse(
  proseById: Map<string, StudioProseDto>,
  momentId: string,
): boolean {
  return (proseById.get(momentId)?.markdown.trim().length ?? 0) > 0;
}

function upNextFor(
  scenes: SceneEntry[],
  proseById: Map<string, StudioProseDto>,
): { sceneId: string } | null {
  let lastScene = -1;
  let lastMoment = -1;
  scenes.forEach((entry, sceneIndex) => {
    entry.moments.forEach((moment, momentIndex) => {
      if (hasProse(proseById, moment.id)) {
        lastScene = sceneIndex;
        lastMoment = momentIndex;
      }
    });
  });
  if (lastScene < 0) {
    const first = scenes[0];
    return first ? { sceneId: first.scene.id } : null;
  }
  for (let index = lastScene; index < scenes.length; index++) {
    const entry = scenes[index];
    // In the last written scene only beats after the last prose count, so a
    // gap left earlier never pulls "Up next" backwards.
    const from = index === lastScene ? lastMoment + 1 : 0;
    const hasUnwritten = entry.moments
      .slice(from)
      .some((moment) => !hasProse(proseById, moment.id));
    if (hasUnwritten || (entry.moments.length === 0 && index > lastScene)) {
      return { sceneId: entry.scene.id };
    }
  }
  return null;
}

/**
 * The first scene after the last written moment (plan order) that still has
 * an unwritten or empty beat set; the first scene when nothing is written.
 */
export function findUpNext(
  planItems: StudioPlanItemDto[],
  proseById: Map<string, StudioProseDto>,
): { sceneId: string } | null {
  return upNextFor(sceneEntries(planItems).scenes, proseById);
}

/**
 * Lays out only what has been written, as one flat list of book blocks:
 * chapter openers, scene breaks, written moments and drafts. A chapter or
 * scene with neither prose nor a draft never appears. A beat with a draft
 * shows the draft in place of its prose until Keep. The writing loop's draft
 * wins over the chat's suggested one for the same beat; the chat's can also
 * include beats it proposes. A flat keyed list lets React keep an editor's
 * instance when its position shifts.
 */
export function buildManuscriptLayout({
  activeMomentId = null,
  chatDraftByMomentId = new Map(),
  draftByMomentId,
  planItems,
  proposedBeats = [],
  proseById,
}: {
  planItems: StudioPlanItemDto[];
  proseById: Map<string, StudioProseDto>;
  draftByMomentId: ReadonlyMap<string, BeatDraft>;
  /** The chat's suggested prose, by saved moment or proposed beat id. */
  chatDraftByMomentId?: ReadonlyMap<string, BeatDraft>;
  /** Proposed beats in saved scenes, for placing their chat drafts. */
  proposedBeats?: readonly ManuscriptProposedBeat[];
  /** The focused editor stays mounted even when its prose is emptied. */
  activeMomentId?: string | null;
}): ManuscriptLayout {
  const { chapters, scenes } = sceneEntries(planItems);

  const isRendered = (moment: StudioPlanItemDto) => {
    const prose = proseById.get(moment.id);
    if (!prose) return false;
    return prose.markdown.trim().length > 0 || moment.id === activeMomentId;
  };

  const blocks: ManuscriptBlock[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const chapterBlocks: ManuscriptBlock[] = [];
    let renderedScenes = 0;
    for (const entry of scenes) {
      if (entry.chapterId !== chapter.id) continue;
      const sceneId = entry.scene.id;
      const placement = { sceneId, chapterId: chapter.id, sceneStart: false };
      const sceneBlocks: ManuscriptBlock[] = [];
      const moments = new Map(
        entry.moments.map((node) => [node.id, stripNode(node)]),
      );
      const beatIds = withProposedBeats(
        [...moments.keys()],
        proposedBeats.filter((beat) => beat.sceneId === sceneId),
      );
      for (const momentId of beatIds) {
        const moment = moments.get(momentId);
        const loopDraft = moment ? draftByMomentId.get(momentId) : undefined;
        const draft = loopDraft ?? chatDraftByMomentId.get(momentId);
        const source: ManuscriptDraftSource = loopDraft ? "loop" : "chat";
        const last = sceneBlocks.at(-1);
        if (draft && last?.type === "draft" && last.source === source) {
          last.beats.push({ momentId, draft });
        } else if (draft) {
          sceneBlocks.push({
            type: "draft",
            source,
            beats: [{ momentId, draft }],
            endsDraft: false,
            ...placement,
          });
        } else if (moment && isRendered(moment)) {
          sceneBlocks.push({ type: "moment", moment, ...placement });
        }
      }
      const [first] = sceneBlocks;
      if (!first) continue;
      if (first.type === "moment" || first.type === "draft") {
        first.sceneStart = true;
      }
      for (const source of ["loop", "chat"] as const) {
        const lastDraft = sceneBlocks.findLast(
          (block) => block.type === "draft" && block.source === source,
        );
        if (lastDraft?.type === "draft") lastDraft.endsDraft = true;
      }
      if (renderedScenes > 0) {
        chapterBlocks.push({ type: "break", sceneId, chapterId: chapter.id });
      }
      renderedScenes++;
      chapterBlocks.push(...sceneBlocks);
    }
    // A chapter opener exists only when one of its scenes renders.
    if (chapterBlocks.length === 0) return;
    blocks.push(
      {
        type: "chapter",
        chapter: stripNode(chapter),
        number: chapterIndex + 1,
      },
      ...chapterBlocks,
    );
  });

  return {
    blocks,
    upNext: upNextFor(scenes, proseById),
    chapterCount: chapters.length,
    sceneCount: scenes.length,
  };
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

/** "One", "Two", … "Twenty-one"; digits from 100 on. */
export function chapterNumberWord(value: number): string {
  if (value > 0 && value < 20) return ONES[value];
  if (value >= 20 && value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const ones = value % 10;
    return ones ? `${tens}-${ONES[ones].toLowerCase()}` : tens;
  }
  return String(value);
}
