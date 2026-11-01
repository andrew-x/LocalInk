import { z } from "zod";

import { studioAspectSchema, studioStyleSchema } from "@/lib/studio/contracts";

const id = z.string().trim().min(1).max(128);

export const STUDIO_PLAN_STORY_TARGET = "story";
export const STUDIO_QUESTIONS_MIN = 3;
export const STUDIO_QUESTIONS_MAX = 7;
export const STUDIO_ALTERNATIVE_COUNT = 3;

export const studioQuestionsRequestSchema = z.object({ storyId: id });

export type StudioQuestionsResponse = {
  questions: { id: string; question: string; why: string }[];
};

/** Model output for onboarding questions. Ids are reassigned by the server. */
export const studioQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        question: z.string().trim().min(1),
        why: z.string(),
      }),
    )
    .min(STUDIO_QUESTIONS_MIN)
    .max(STUDIO_QUESTIONS_MAX),
});

export const studioPlanRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("initial"),
    storyId: id,
    answers: z
      .array(
        z.object({
          questionId: id,
          question: z.string().max(1000),
          answer: z.string().max(4000),
        }),
      )
      .max(STUDIO_QUESTIONS_MAX),
  }),
  z.object({
    mode: z.literal("flesh-out"),
    storyId: id,
    /** A plan item id, or "story" to flesh out every chapter without scenes. */
    targetItemId: id,
  }),
  z.object({
    mode: z.literal("alternatives"),
    storyId: id,
    targetItemId: id,
  }),
  z.object({
    mode: z.literal("rewrite-brief"),
    storyId: id,
    targetItemId: id,
    instruction: z.string().trim().min(1).max(2000),
  }),
]);

export type StudioPlanRequest = z.infer<typeof studioPlanRequestSchema>;
export type StudioPlanMode = StudioPlanRequest["mode"];

const tempId = z.string().min(1);
const craftSchema = z.record(z.string(), z.string());

const initialPlannedChangeSchema = z.object({
  entryTempId: tempId,
  aspect: studioAspectSchema,
  aboutTempId: z.string().nullish(),
  value: z.string(),
});

const initialSceneSchema = z.object({
  title: z.string(),
  whatHappens: z.string(),
  howToWrite: z.string(),
  craft: craftSchema,
  presentTempIds: z.array(z.string()),
  plannedChanges: z.array(initialPlannedChangeSchema),
});

export const studioInitialPlanSchema = z.object({
  overview: z.string(),
  instructions: z.string(),
  style: studioStyleSchema,
  theme: z.string(),
  structureTemplate: z.enum(["romance", "coming-of-age", "quiet", "freeform"]),
  entries: z.array(
    z.object({
      tempId,
      type: z.enum([
        "character",
        "relationship",
        "place",
        "thing",
        "lore",
        "custom",
      ]),
      name: z.string(),
      summary: z.string(),
      fields: z.record(z.string(), z.string()),
      relatedTempIds: z.array(z.string()),
    }),
  ),
  chapters: z.array(
    initialSceneSchema.extend({
      tension: z.number().int().min(1).max(10),
      scenes: z.array(initialSceneSchema).optional(),
    }),
  ),
});

export type StudioInitialPlan = z.infer<typeof studioInitialPlanSchema>;

export const studioChildrenSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      whatHappens: z.string(),
      howToWrite: z.string(),
      craft: craftSchema,
      presentEntryIds: z.array(z.string()),
      plannedChanges: z.array(
        z.object({
          entryId: z.string(),
          aspect: studioAspectSchema,
          aboutEntryId: z.string().nullish(),
          value: z.string(),
        }),
      ),
    }),
  ),
});

export type StudioChildren = z.infer<typeof studioChildrenSchema>;

export const studioBriefSchema = z.object({
  title: z.string(),
  whatHappens: z.string(),
  howToWrite: z.string(),
});

export type StudioBrief = z.infer<typeof studioBriefSchema>;

export const studioAlternativesSchema = z.object({
  options: z.array(studioBriefSchema).length(STUDIO_ALTERNATIVE_COUNT),
});

export type StudioAlternatives = z.infer<typeof studioAlternativesSchema>;

/**
 * The validated model output held in server memory until the author applies
 * it. Flesh-out is a list of groups because "story" fills many chapters.
 */
export type StagedStudioPlan =
  | { mode: "initial"; targetItemId: null; plan: StudioInitialPlan }
  | {
      mode: "flesh-out";
      targetItemId: string;
      groups: { parentId: string; items: StudioChildren["items"] }[];
    }
  | {
      mode: "alternatives";
      targetItemId: string;
      options: StudioAlternatives["options"];
    }
  | { mode: "rewrite-brief"; targetItemId: string; brief: StudioBrief };

/** What a plan route returns. Full payloads stay on the server. */
export type StudioPlanPreview = {
  generationId: string;
  mode: StudioPlanMode;
  summary: string;
  options?: { title: string; whatHappens: string }[];
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function toStudioPlanPreview(
  staged: StagedStudioPlan,
  generationId: string,
): StudioPlanPreview {
  switch (staged.mode) {
    case "initial": {
      const sceneCount = staged.plan.chapters.reduce(
        (total, chapter) => total + (chapter.scenes?.length ?? 0),
        0,
      );
      return {
        generationId,
        mode: "initial",
        summary: `${plural(staged.plan.chapters.length, "chapter")}${
          sceneCount > 0 ? `, ${plural(sceneCount, "scene")}` : ""
        } and ${staged.plan.entries.length} Bible ${
          staged.plan.entries.length === 1 ? "entry" : "entries"
        }.`,
      };
    }
    case "flesh-out": {
      const count = staged.groups.reduce(
        (total, group) => total + group.items.length,
        0,
      );
      return {
        generationId,
        mode: "flesh-out",
        summary: `${plural(count, "new item")} across ${plural(staged.groups.length, "parent")}.`,
      };
    }
    case "alternatives":
      return {
        generationId,
        mode: "alternatives",
        summary: `${plural(staged.options.length, "alternative")} to choose from.`,
        options: staged.options.map(({ title, whatHappens }) => ({
          title,
          whatHappens,
        })),
      };
    case "rewrite-brief":
      return {
        generationId,
        mode: "rewrite-brief",
        summary: "A rewritten brief.",
        options: [
          {
            title: staged.brief.title,
            whatHappens: staged.brief.whatHappens,
          },
        ],
      };
  }
}
