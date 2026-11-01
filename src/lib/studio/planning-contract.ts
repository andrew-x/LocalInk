import { z } from "zod";

import { ActionError } from "@/lib/action-error";
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

/**
 * Model output schemas below are sent to the provider in strict JSON-schema
 * mode: every property is required, nothing is optional, and there are no
 * records or numeric/length bounds. Constraints are enforced by the
 * `normalize*` functions after parsing, which also convert key/value lists to
 * records and nulls to absent values.
 */
function generationFailed(message: string): ActionError {
  return new ActionError("GENERATION_FAILED", message);
}

/** Model output for onboarding questions. Ids are reassigned by the server. */
export const studioQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      why: z.string(),
    }),
  ),
});

export function normalizeStudioQuestions(
  raw: z.infer<typeof studioQuestionsSchema>,
): z.infer<typeof studioQuestionsSchema> {
  const questions = raw.questions.filter(
    (question) => question.question.trim().length > 0,
  );
  if (
    questions.length < STUDIO_QUESTIONS_MIN ||
    questions.length > STUDIO_QUESTIONS_MAX
  ) {
    throw generationFailed(
      "The model did not return a usable set of questions. Try again.",
    );
  }
  return { questions };
}

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

const keyValueListSchema = z.array(
  z.object({ key: z.string(), value: z.string() }),
);

/** First non-empty value for a key wins; empty keys are dropped. */
function keyValueListToRecord(
  list: z.infer<typeof keyValueListSchema>,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, value } of list) {
    const trimmedKey = key.trim();
    if (!trimmedKey || !value.trim() || trimmedKey in record) continue;
    record[trimmedKey] = value;
  }
  return record;
}

const initialPlannedChangeSchema = z.object({
  entryTempId: z.string(),
  aspect: studioAspectSchema,
  aboutTempId: z.string().nullable(),
  value: z.string(),
});

const initialSceneSchema = z.object({
  title: z.string(),
  whatHappens: z.string(),
  howToWrite: z.string(),
  craft: keyValueListSchema,
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
      tempId: z.string(),
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
      fields: keyValueListSchema,
      relatedTempIds: z.array(z.string()),
    }),
  ),
  chapters: z.array(
    initialSceneSchema.extend({
      tension: z.number(),
      scenes: z.array(initialSceneSchema).nullable(),
    }),
  ),
});

type RawInitialPlan = z.infer<typeof studioInitialPlanSchema>;
type RawInitialScene = z.infer<typeof initialSceneSchema>;

export type StudioInitialScene = Omit<RawInitialScene, "craft"> & {
  craft: Record<string, string>;
};
export type StudioInitialPlan = Omit<RawInitialPlan, "entries" | "chapters"> & {
  entries: (Omit<RawInitialPlan["entries"][number], "fields"> & {
    fields: Record<string, string>;
  })[];
  chapters: (StudioInitialScene & {
    tension: number;
    scenes?: StudioInitialScene[];
  })[];
};

function normalizeScene(scene: RawInitialScene): StudioInitialScene {
  return { ...scene, craft: keyValueListToRecord(scene.craft) };
}

export function normalizeStudioInitialPlan(
  raw: RawInitialPlan,
): StudioInitialPlan {
  if (raw.chapters.length === 0) {
    throw generationFailed("The plan came back empty. Please try again.");
  }
  return {
    ...raw,
    entries: raw.entries.map((entry) => ({
      ...entry,
      fields: keyValueListToRecord(entry.fields),
    })),
    chapters: raw.chapters.map(({ scenes, tension, ...chapter }) => ({
      ...normalizeScene(chapter),
      tension: Math.min(10, Math.max(1, Math.round(tension))),
      scenes:
        scenes && scenes.length > 0 ? scenes.map(normalizeScene) : undefined,
    })),
  };
}

export const studioChildrenSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      whatHappens: z.string(),
      howToWrite: z.string(),
      craft: keyValueListSchema,
      presentEntryIds: z.array(z.string()),
      plannedChanges: z.array(
        z.object({
          entryId: z.string(),
          aspect: studioAspectSchema,
          aboutEntryId: z.string().nullable(),
          value: z.string(),
        }),
      ),
    }),
  ),
});

type RawChildren = z.infer<typeof studioChildrenSchema>;
export type StudioChildren = {
  items: (Omit<RawChildren["items"][number], "craft"> & {
    craft: Record<string, string>;
  })[];
};

export function normalizeStudioChildren(raw: RawChildren): StudioChildren {
  return {
    items: raw.items.map((item) => ({
      ...item,
      craft: keyValueListToRecord(item.craft),
    })),
  };
}

export const studioBriefSchema = z.object({
  title: z.string(),
  whatHappens: z.string(),
  howToWrite: z.string(),
});

export type StudioBrief = z.infer<typeof studioBriefSchema>;

export const studioAlternativesSchema = z.object({
  options: z.array(studioBriefSchema),
});

export function normalizeStudioAlternatives(
  raw: z.infer<typeof studioAlternativesSchema>,
): z.infer<typeof studioAlternativesSchema> {
  if (raw.options.length !== STUDIO_ALTERNATIVE_COUNT) {
    throw generationFailed(
      "The model did not return three alternatives. Try again.",
    );
  }
  return raw;
}

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
