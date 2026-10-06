// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";

import type { PreparedStoryProseGenerationRequest } from "@/lib/server/story-prose-context";

mock.module("server-only", () => ({}));

const limits = {
  contextWindowTokens: 262_144,
  maxCompletionTokens: 209_715,
  requestedOutputTokens: 1_700,
};

function fixture(): PreparedStoryProseGenerationRequest {
  const focusedChapter = {
    id: "focused",
    name: "At the door",
    position: 4,
    content: "Mara waited. The password was revealed later.",
    synopsis: "Mara learns the password: lantern.",
  };
  return {
    synopsisProvenance: new Map(),
    model: "deepseekV4Pro",
    approximateLength: 600,
    story: {
      id: "story",
      name: "The Door",
      description: "",
      backstory: "",
      systemInstructions: "",
    },
    chapters: [focusedChapter],
    focusedChapter,
    insertion: {
      beforeText: "Mara waited.",
      afterText: "The password was revealed later.",
      selectedText: "",
      atChapterEnd: false,
    },
    style: "",
    characters: [],
    locations: [],
    voiceExemplars: [],
    instructions: "Let her try the door.",
    pacing: "auto",
    beatGoal: "",
  };
}

describe("cursor-aware story context", () => {
  test("never introduces a focused chapter's future revelation as current state", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const request = fixture();
    request.chapters.unshift({
      id: "earlier",
      name: "Arrival",
      position: 1,
      content: "She arrived.",
      synopsis: "She has reached the door.",
    });
    const prompt = buildStoryProsePrompt(request);
    expect(prompt).toContain("She has reached the door.");
    expect(prompt).not.toContain("lantern");
    expect(prompt).toContain("The password was revealed later.");
  });

  test("includes focused state only for a real end append", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const request = fixture();
    request.insertion = {
      beforeText: request.focusedChapter.content,
      afterText: "",
      selectedText: "",
      atChapterEnd: true,
    };
    expect(buildStoryProsePrompt(request)).toContain("lantern");

    request.insertion.selectedText = "later";
    expect(buildStoryProsePrompt(request)).not.toContain("lantern");
    request.insertion.selectedText = "";
    request.insertion.isRewrite = true;
    const rewrite = buildStoryProsePrompt(request);
    expect(rewrite).not.toContain("lantern");
    expect(rewrite).toContain("replace-selected-text");
    expect(rewrite).toContain("<SELECTION_START/>");
  });

  test("writer voice and requested mechanics do not inherit a manuscript-style override", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const system = buildStoryProseSystemPrompt(
      "Use a plain voice",
      "Use first person",
    );
    expect(system).toContain("they override inferred manuscript style");
    expect(system).toContain(
      "manuscript facts and character knowledge outrank conflicting notes",
    );
    expect(system).toContain(
      "Manuscript mechanics are defaults unless the current request changes them",
    );
    expect(system).not.toContain(
      "the story's established style are more specific",
    );
  });
});

describe("assembled prose prompt budget", () => {
  test("retains a full 10,000-character multiline brief in the budgeted prompt", async () => {
    const { buildBudgetedStoryProsePrompt } = await import(
      "./story-prose-generation"
    );
    const request = fixture();
    request.instructions = `Begin here.\n${"x".repeat(9_976)}\nFinish here`;

    expect(request.instructions.length).toBe(10_000);
    const result = buildBudgetedStoryProsePrompt(request, {
      ...limits,
      system: "Write fiction.",
    });

    expect(result.prompt).toContain(request.instructions);
    expect(
      result.inputTokenUpperBound + result.maxOutputTokens,
    ).toBeLessThanOrEqual(limits.contextWindowTokens);
  });

  test("accepts a long summarized manuscript based on the rendered request", async () => {
    const { buildBudgetedStoryProsePrompt, buildStoryProseSystemPrompt } =
      await import("./story-prose-generation");
    const request = fixture();
    request.focusedChapter.position = 50;
    request.chapters = Array.from({ length: 40 }, (_, i) => ({
      id: `chapter-${i}`,
      name: `Chapter ${i}`,
      position: i + 1,
      content: "Chapter text. ".repeat(4_000),
      synopsis: `Established event ${i}.`,
    }));
    expect(
      request.chapters.reduce(
        (size, chapter) => size + chapter.content.length,
        0,
      ),
    ).toBeGreaterThan(1_500_000);
    const result = buildBudgetedStoryProsePrompt(request, {
      ...limits,
      system: buildStoryProseSystemPrompt(),
    });
    expect(
      result.inputTokenUpperBound + result.maxOutputTokens,
    ).toBeLessThanOrEqual(limits.contextWindowTokens);
    expect(result.prompt).toContain("Established event 0.");
    expect(result.prompt).toContain("<INSERTION_POINT/>");
    expect(result.maxOutputTokens).toBe(1_700);
  });

  test("reduces unsummarized chapters without losing their identities", async () => {
    const { buildBudgetedStoryProsePrompt } = await import(
      "./story-prose-generation"
    );
    const request = fixture();
    request.chapters = Array.from({ length: 30 }, (_, i) => ({
      id: `chapter-${i}`,
      name: `Chapter ${i}`,
      position: i + 1,
      content: "x".repeat(30_000),
      synopsis: "",
    }));
    request.story.backstory =
      "Mara and Ivo survived the flood together. Only Mara knows who opened the gate.";
    const result = buildBudgetedStoryProsePrompt(request, {
      ...limits,
      system: "Write fiction.",
      contextWindowTokens: 70_000,
    });
    expect(
      result.inputTokenUpperBound + result.maxOutputTokens,
    ).toBeLessThanOrEqual(70_000);
    expect(result.prompt).toContain("<TITLE>\nChapter 0\n</TITLE>");
    expect(result.prompt).toContain("<TITLE>\nChapter 29\n</TITLE>");
    expect(result.prompt).toContain("middle omitted");
    expect(result.prompt).toContain("Mara waited.");
    expect(result.prompt).toContain("The password was revealed later.");
    expect(result.prompt).toContain(request.story.backstory);
  });

  test("neighbouring chapters cannot bypass the hard model budget", async () => {
    const { buildBudgetedStoryProsePrompt } = await import(
      "./story-prose-generation"
    );
    const request = fixture();
    request.chapters = [2, 3, 5, 6].map((position) => ({
      id: `chapter-${position}`,
      name: `Neighbour ${position}`,
      position,
      content: "y".repeat(120_000),
      synopsis: `Neighbour ${position} outcome.`,
    }));
    const result = buildBudgetedStoryProsePrompt(request, {
      ...limits,
      system: "Write fiction.",
    });
    expect(
      result.inputTokenUpperBound + result.maxOutputTokens,
    ).toBeLessThanOrEqual(limits.contextWindowTokens);
    expect(result.prompt).toContain("<CHAPTER_TEXT_INCLUDED>\nfalse");
    expect(result.prompt).toContain("Mara waited.");
  });

  test("counts escaped references, system instructions and UTF-8 bytes", async () => {
    const { buildBudgetedStoryProsePrompt, StoryProseContextTooLargeError } =
      await import("./story-prose-generation");
    const request = fixture();
    request.style = "&<".repeat(2_000);
    request.story.backstory = "&<".repeat(2_000);
    request.insertion.beforeText = "語".repeat(10_000);
    const system = "Global preference. ".repeat(1_000);
    expect(() =>
      buildBudgetedStoryProsePrompt(request, {
        ...limits,
        system,
        contextWindowTokens: 70_000,
      }),
    ).toThrow(StoryProseContextTooLargeError);
    const result = buildBudgetedStoryProsePrompt(request, {
      ...limits,
      system,
    });
    expect(result.inputTokenUpperBound).toBeGreaterThan(
      Buffer.byteLength(system + result.prompt, "utf8"),
    );
    expect(result.prompt).toContain("&amp;&lt;");
  });

  test("counts escaped backstory and rejects it when fixed reference context cannot fit", async () => {
    const { buildBudgetedStoryProsePrompt, StoryProseContextTooLargeError } =
      await import("./story-prose-generation");
    const request = fixture();
    const options = { ...limits, system: "Write fiction." };
    const withoutBackstory = buildBudgetedStoryProsePrompt(request, options);
    request.story.backstory = "&<語".repeat(1_000);
    const withBackstory = buildBudgetedStoryProsePrompt(request, options);
    const renderedBackstory = "&amp;&lt;語".repeat(1_000);
    expect(withBackstory.prompt).toContain(renderedBackstory);
    expect(
      withBackstory.inputTokenUpperBound -
        withoutBackstory.inputTokenUpperBound,
    ).toBeGreaterThanOrEqual(Buffer.byteLength(renderedBackstory, "utf8"));

    request.story.backstory = "&<".repeat(30_000);
    expect(() => buildBudgetedStoryProsePrompt(request, options)).toThrow(
      StoryProseContextTooLargeError,
    );
  });

  test("rejects irreducible insertion context rather than trimming the requested span", async () => {
    const { buildBudgetedStoryProsePrompt, StoryProseContextTooLargeError } =
      await import("./story-prose-generation");
    const request = fixture();
    request.insertion.selectedText = "Selected prose. ".repeat(20_000);
    expect(() =>
      buildBudgetedStoryProsePrompt(request, {
        ...limits,
        system: "Write fiction.",
      }),
    ).toThrow(StoryProseContextTooLargeError);
  });

  test("unbounded requests reserve output and cap it to remaining model capacity", async () => {
    const { buildBudgetedStoryProsePrompt } = await import(
      "./story-prose-generation"
    );
    const request = fixture();
    request.approximateLength = "unlimited";
    const result = buildBudgetedStoryProsePrompt(request, {
      system: "Write fiction.",
      contextWindowTokens: 50_000,
      maxCompletionTokens: 49_000,
    });
    expect(result.maxOutputTokens).toBe(50_000 - result.inputTokenUpperBound);
    expect(result.maxOutputTokens).toBeGreaterThanOrEqual(8_192);
    expect(result.prompt).not.toContain("TARGET_WORD_COUNT");

    const capped = buildBudgetedStoryProsePrompt(request, {
      system: "Write fiction.",
      contextWindowTokens: 50_000,
      maxCompletionTokens: 10_000,
    });
    expect(capped.maxOutputTokens).toBe(10_000);
  });
});
