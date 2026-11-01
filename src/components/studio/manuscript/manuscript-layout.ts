import type { StudioPlanItemDto, StudioProseDto } from "@/lib/studio/contracts";
import { buildPlanTree, type StudioPlanNode } from "@/lib/studio/plan-order";

/** Where typing (or Continue) after the last written prose goes. */
export type ContinueTarget =
  | { kind: "moment"; moment: StudioPlanItemDto; sceneId: string }
  /** A scene with no moments yet: Continue plans them first. */
  | { kind: "scene"; scene: StudioPlanItemDto }
  /** Nothing planned follows: typing creates a moment at the scene's end. */
  | { kind: "new"; sceneId: string; afterMomentId: string | null };

type Placement = { sceneId: string; chapterId: string; sceneStart: boolean };

export type ManuscriptBlock =
  | { type: "chapter"; chapter: StudioPlanItemDto; number: number }
  | { type: "break"; sceneId: string; chapterId: string }
  | ({ type: "moment"; moment: StudioPlanItemDto } & Placement)
  | ({
      type: "draft";
      moment: StudioPlanItemDto;
      /** The moment already has prose, shown above until Keep. */
      replacesProse: boolean;
    } & Placement)
  | ({ type: "continue"; target: ContinueTarget } & Placement);

export type ManuscriptLayout = {
  blocks: ManuscriptBlock[];
  target: ContinueTarget | null;
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

function targetSceneId(target: ContinueTarget): string {
  if (target.kind === "moment") return target.sceneId;
  if (target.kind === "scene") return target.scene.id;
  return target.sceneId;
}

/**
 * §7.5: typing after the last written prose writes the next planned moment;
 * with none, a new moment at the end of the last written moment's scene.
 * "Next" means after the last written moment, so a gap left earlier in the
 * story never pulls the continue editor backwards. Chapters without scenes
 * are skipped; they need planning in the tree first.
 */
function findContinueTarget(
  scenes: SceneEntry[],
  isRendered: (moment: StudioPlanItemDto) => boolean,
): ContinueTarget | null {
  let lastScene = -1;
  let lastMoment = -1;
  scenes.forEach((entry, sceneIndex) => {
    entry.moments.forEach((moment, momentIndex) => {
      if (isRendered(moment)) {
        lastScene = sceneIndex;
        lastMoment = momentIndex;
      }
    });
  });

  for (let index = Math.max(lastScene, 0); index < scenes.length; index++) {
    const entry = scenes[index];
    const from = index === lastScene ? lastMoment + 1 : 0;
    const next = entry.moments.slice(from).find((m) => !isRendered(m));
    if (next) {
      return {
        kind: "moment",
        moment: stripNode(next),
        sceneId: entry.scene.id,
      };
    }
    if (entry.moments.length === 0) {
      return { kind: "scene", scene: stripNode(entry.scene) };
    }
  }

  const last = lastScene >= 0 ? scenes[lastScene] : scenes[0];
  if (!last) return null;
  return {
    kind: "new",
    sceneId: last.scene.id,
    afterMomentId: last.moments.at(-1)?.id ?? null,
  };
}

/**
 * Lays the plan out as one flat list of book blocks. A flat keyed list lets
 * React keep an editor's instance when it moves from "continue" to "written".
 */
export function buildManuscriptLayout({
  activeMomentId,
  draftMomentId,
  planItems,
  proseById,
}: {
  planItems: StudioPlanItemDto[];
  proseById: Map<string, StudioProseDto>;
  /** The focused editor stays mounted even when its prose is emptied. */
  activeMomentId: string | null;
  draftMomentId: string | null;
}): ManuscriptLayout {
  const chapters = buildPlanTree(planItems).filter(
    (node) => node.kind === "chapter",
  );
  const scenes: SceneEntry[] = chapters.flatMap((chapter) =>
    chapter.children
      .filter((child) => child.kind === "scene")
      .map((scene) => ({
        scene,
        chapterId: chapter.id,
        moments: scene.children.filter((child) => child.kind === "moment"),
      })),
  );

  const isRendered = (moment: StudioPlanItemDto) => {
    const prose = proseById.get(moment.id);
    if (!prose) return false;
    return prose.markdown.trim().length > 0 || moment.id === activeMomentId;
  };
  const target = findContinueTarget(scenes, isRendered);

  const blocks: ManuscriptBlock[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const chapterBlocks: ManuscriptBlock[] = [];
    let renderedScenes = 0;
    for (const entry of scenes) {
      if (entry.chapterId !== chapter.id) continue;
      const sceneId = entry.scene.id;
      const placement = { sceneId, chapterId: chapter.id, sceneStart: false };
      const sceneBlocks: ManuscriptBlock[] = [];
      for (const node of entry.moments) {
        const moment = stripNode(node);
        const written = isRendered(moment);
        if (written) sceneBlocks.push({ type: "moment", moment, ...placement });
        if (moment.id === draftMomentId) {
          sceneBlocks.push({
            type: "draft",
            moment,
            replacesProse: written,
            ...placement,
          });
        } else if (
          !written &&
          target?.kind === "moment" &&
          target.moment.id === moment.id
        ) {
          sceneBlocks.push({ type: "continue", target, ...placement });
        }
      }
      if (
        target &&
        target.kind !== "moment" &&
        targetSceneId(target) === sceneId
      ) {
        sceneBlocks.push({ type: "continue", target, ...placement });
      }
      if (sceneBlocks.length === 0) continue;

      const [first] = sceneBlocks;
      if (first && first.type !== "chapter" && first.type !== "break") {
        first.sceneStart = true;
      }
      if (renderedScenes > 0) {
        chapterBlocks.push({ type: "break", sceneId, chapterId: chapter.id });
      }
      renderedScenes++;
      chapterBlocks.push(...sceneBlocks);
    }
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
    target,
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
