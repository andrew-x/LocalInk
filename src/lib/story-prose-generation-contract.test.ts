// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import {
  MAX_STORY_PROSE_INSTRUCTIONS_LENGTH,
  storyProseGenerationFormSchema,
  storyProseGenerationRequestSchema,
} from "./story-prose-generation-contract";

const chapter = {
  id: "chapter",
  name: "Arrival",
  position: 1,
  content: "The door opened.",
};

function request(instructions: string) {
  return {
    story: { id: "story", name: "The Door", description: "" },
    style: "",
    characters: [],
    locations: [],
    chapters: [chapter],
    focusedChapter: chapter,
    insertion: {
      beforeText: chapter.content,
      afterText: "",
      atChapterEnd: true,
    },
    instructions,
    approximateLength: 400,
  };
}

describe("prose composer contract", () => {
  test("defaults omitted backstory for older callers and trims supplied history without a field cap", () => {
    const values = request("");
    expect(
      storyProseGenerationRequestSchema.parse(values).story.backstory,
    ).toBe("");

    const backstory = "Their shared history.\n".repeat(1_000).trim();
    const parsed = storyProseGenerationRequestSchema.parse({
      ...values,
      story: { ...values.story, backstory: `  ${backstory}\n  ` },
    });
    expect(parsed.story.backstory).toBe(backstory);
    expect(
      storyProseGenerationRequestSchema.parse({
        ...values,
        story: { ...values.story, backstory: "   \n" },
      }).story.backstory,
    ).toBe("");
  });

  test("accepts a multiline 10,000-character brief in the form and request", () => {
    const instructions = `Begin here.\n${"x".repeat(MAX_STORY_PROSE_INSTRUCTIONS_LENGTH - 12)}`;
    const values = request(instructions);

    expect(instructions.length).toBe(10_000);
    expect(storyProseGenerationFormSchema.parse(values).instructions).toBe(
      instructions,
    );
    expect(storyProseGenerationRequestSchema.parse(values).instructions).toBe(
      instructions,
    );
  });

  test("rejects a brief over 10,000 characters in the form and request", () => {
    const values = request("x".repeat(MAX_STORY_PROSE_INSTRUCTIONS_LENGTH + 1));

    expect(storyProseGenerationFormSchema.safeParse(values).success).toBe(
      false,
    );
    expect(storyProseGenerationRequestSchema.safeParse(values).success).toBe(
      false,
    );
  });

  test("preserves blank-brief continuation and the optional beat and pacing defaults", () => {
    const values = request("");

    expect(storyProseGenerationFormSchema.parse(values)).toEqual({
      approximateLength: 400,
      beatGoal: "",
      instructions: "",
      pacing: "auto",
    });
    expect(
      storyProseGenerationRequestSchema.parse({ ...values, beatGoal: "" })
        .beatGoal,
    ).toBe("");
  });

  test("keeps the optional beat change capped at 300 characters", () => {
    expect(
      storyProseGenerationFormSchema.safeParse({
        ...request(""),
        beatGoal: "x".repeat(300),
      }).success,
    ).toBe(true);
    expect(
      storyProseGenerationRequestSchema.safeParse({
        ...request(""),
        beatGoal: "x".repeat(301),
      }).success,
    ).toBe(false);
  });
});
