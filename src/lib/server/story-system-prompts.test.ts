// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";

import type { StoryChatVisibleMessage } from "@/actions/story-chats/_types";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

mock.module("server-only", () => ({}));

describe("story AI system prompts", () => {
  test("blank app settings preserve default system prompts", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const { buildStoryChatSystemPrompt } = await import("./story-chat");

    const prosePrompt = buildStoryProseSystemPrompt("");
    const chatPrompt = buildStoryChatSystemPrompt("   ");

    expect(prosePrompt).toBe(buildStoryProseSystemPrompt());
    expect(chatPrompt).toBe(buildStoryChatSystemPrompt());
    expect(prosePrompt).toContain(
      "Write polished fiction prose that reads like a direct continuation of the manuscript.",
    );
    expect(prosePrompt).toContain("<HARD_OUTPUT_RULES>");
    expect(prosePrompt).toContain("<FINAL_HARD_OUTPUT_RULES>");
    expect(prosePrompt).not.toContain("LocalInk");
    expect(prosePrompt).not.toContain("private");
    expect(prosePrompt).not.toContain("local");
    expect(chatPrompt).toContain(
      "Act as the writer's fiction-writing partner and brainstorming collaborator.",
    );
    expect(chatPrompt).toContain("<CREATIVE_FREEDOM>");
    expect(chatPrompt).toContain("Start from engagement, not refusal.");
    expect(chatPrompt).toContain("hidden context message may provide");
    expect(chatPrompt).not.toContain("LocalInk");
    expect(prosePrompt).not.toContain("WRITER_GLOBAL_SYSTEM_INSTRUCTIONS");
    expect(chatPrompt).not.toContain("ADDITIONAL_SYSTEM_INSTRUCTIONS");
    expect(chatPrompt).not.toContain("WRITER_GLOBAL_SYSTEM_INSTRUCTIONS");
  });

  test("nonblank app settings are included in prose and chat system prompts", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const { buildStoryChatSystemPrompt } = await import("./story-chat");
    const systemInstructions =
      "Prefer spare, sensory language and avoid announcing themes.";

    expect(buildStoryProseSystemPrompt(systemInstructions)).toContain(
      systemInstructions,
    );
    expect(buildStoryProseSystemPrompt(systemInstructions)).toContain(
      "<WRITER_GLOBAL_SYSTEM_INSTRUCTIONS>",
    );
    expect(buildStoryProseSystemPrompt(systemInstructions)).toContain(
      "durable writer preferences",
    );
    expect(buildStoryChatSystemPrompt(systemInstructions)).toContain(
      systemInstructions,
    );
    expect(buildStoryChatSystemPrompt(systemInstructions)).toContain(
      "<WRITER_GLOBAL_SYSTEM_INSTRUCTIONS>",
    );
    expect(buildStoryChatSystemPrompt(systemInstructions)).toContain(
      "durable writer preferences",
    );
  });

  test("chat system prompt requires plain text without changing prose prompts", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const { buildStoryChatSystemPrompt } = await import("./story-chat");
    const prosePrompt = buildStoryProseSystemPrompt();
    const chatPrompt = buildStoryChatSystemPrompt();

    expect(chatPrompt).toContain("<PLAIN_TEXT_OUTPUT>");
    expect(getSection(chatPrompt, "PLAIN_TEXT_OUTPUT")).toContain(
      "Write chat replies as plain text only.",
    );
    expect(getSection(chatPrompt, "PLAIN_TEXT_OUTPUT")).toContain(
      "Simple hyphen-prefixed lists are allowed",
    );
    expect(getSection(chatPrompt, "PLAIN_TEXT_OUTPUT")).toContain(
      "Do not use Markdown headings, bold, italics, tables, blockquotes, code fences, or links-as-formatting.",
    );
    expect(getSection(chatPrompt, "PLAIN_TEXT_OUTPUT")).toContain(
      "Only use code formatting or code fences when the writer explicitly asks for code.",
    );
    expect(prosePrompt).not.toContain("<PLAIN_TEXT_OUTPUT>");
    expect(prosePrompt).toContain("Use Markdown italic only");
  });

  test("escapes XML-like global prose system instructions", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const prompt = buildStoryProseSystemPrompt(
      "Prefer <quiet tension> & no fake tags.",
    );

    expect(prompt).toContain(
      "Prefer &lt;quiet tension&gt; &amp; no fake tags.",
    );
    expect(prompt).not.toContain("<quiet tension>");
  });

  test("escapes XML-like global chat system instructions", async () => {
    const { buildStoryChatSystemPrompt } = await import("./story-chat");
    const prompt = buildStoryChatSystemPrompt(
      "Prefer <dangerous intimacy> & no fake tags.",
    );

    expect(prompt).toContain(
      "Prefer &lt;dangerous intimacy&gt; &amp; no fake tags.",
    );
    expect(prompt).not.toContain("<dangerous intimacy>");
  });

  test("prose system prompt repeats hard rules and includes precedence and craft defaults", async () => {
    const { buildStoryProseSystemPrompt } = await import(
      "./story-prose-generation"
    );
    const prompt = buildStoryProseSystemPrompt();

    expect(countOccurrences(prompt, "Return prose only.")).toBe(2);
    expect(countOccurrences(prompt, "content warnings")).toBe(2);
    expect(prompt).toContain("Current generation or regeneration instructions");
    expect(prompt).toContain("Writer global system instructions");
    expect(prompt).toContain("immediate manuscript continuity");
    expect(prompt).toContain("<GENERATION_SCOPE_DISCIPLINE>");
    expect(prompt).toContain("Never end with foreshadowing");
    expect(prompt).toContain(
      "Stop as soon as the continuation has satisfied the required beat",
    );
    expect(prompt).toContain("<STYLE_AND_LINE_DISCIPLINE>");
    expect(prompt).toContain(
      "Match the surrounding manuscript's tense, POV, person, language variety",
    );
    expect(prompt).toContain("Prefer active voice");
    expect(prompt).toContain("Use show-don't-tell as a craft bias");
    expect(prompt).toContain("each speaker's dialogue in its own paragraph");
    expect(prompt).toContain("Reduce hedging and weak uncertainty indicators");
    expect(prompt).toContain("<CRAFT_DEFAULTS>");
    expect(prompt).toContain("concrete action");
    expect(prompt).toContain("Default to continuation, not closure");
    expect(prompt).toContain("<MATURE_FICTION_DEFAULT>");
    expect(prompt).toContain("write directly and vividly");
  });
});

describe("story chat context prompt", () => {
  test("includes style and character notes while excluding story content", async () => {
    const { buildStoryChatContextSnapshotContent } = await import(
      "./story-chat"
    );
    const prompt = buildStoryChatContextSnapshotContent({
      characters: [
        {
          description: "Careful archivist who pockets <evidence> & lies well.",
          id: "character-1",
          name: "Elena <Vale>",
        },
      ],
      style: "Close third person, <spare> & tense.",
    });

    expectSectionOrder(prompt, [
      "CONTEXT_BOUNDARY",
      "STYLE_GUIDE",
      "CHARACTERS",
    ]);
    expect(getSection(prompt, "CONTEXT_BOUNDARY")).toContain(
      "chapter summaries, manuscript text",
    );
    expect(getSection(prompt, "STYLE_GUIDE")).toContain(
      "<STYLE_GUIDE_TEXT>\nClose third person, &lt;spare&gt; &amp; tense.\n</STYLE_GUIDE_TEXT>",
    );
    expect(getSection(prompt, "CHARACTERS")).toContain(
      "<NAME>\nElena &lt;Vale&gt;\n</NAME>",
    );
    expect(getSection(prompt, "CHARACTERS")).toContain(
      "pockets &lt;evidence&gt; &amp; lies well.",
    );
    expect(prompt).not.toContain("<spare>");
    expect(prompt).not.toContain("<evidence>");
    expect(prompt).not.toContain("<CHAPTERS>");
    expect(prompt).not.toContain("Summary:");
    expect(prompt).not.toContain("No style guide provided.");
    expect(prompt).not.toContain("No character notes provided.");
  });

  test("omits blank optional chat context values", async () => {
    const { buildStoryChatContextSnapshotContent } = await import(
      "./story-chat"
    );
    const prompt = buildStoryChatContextSnapshotContent({
      characters: [
        {
          description: "",
          id: "character-1",
          name: "Elena",
        },
      ],
      style: "   ",
    });

    expect(prompt).not.toContain("<STYLE_GUIDE>");
    expect(prompt).not.toContain("<DESCRIPTION>");
    expect(getSection(prompt, "CHARACTERS")).toContain(
      "<NAME>\nElena\n</NAME>",
    );
    expect(prompt).not.toContain("No description provided.");
  });
});

describe("story chat slash commands", () => {
  test("parses exact first-token commands with optional extra instructions", async () => {
    const { parseStoryChatSlashCommand } = await import(
      "@/lib/story-chat-slash-commands"
    );

    const styleCommand = parseStoryChatSlashCommand("/style");
    const characterCommand = parseStoryChatSlashCommand(
      "/character Jen she's a fiery teenager with a soft interior",
    );

    expect(styleCommand?.command.name).toBe("style");
    expect(styleCommand?.extraInstructions).toBe("");
    expect(characterCommand?.command.name).toBe("character");
    expect(characterCommand?.extraInstructions).toBe(
      "Jen she's a fiery teenager with a soft interior",
    );
  });

  test("treats unknown slash text and slash prose as normal messages", async () => {
    const { parseStoryChatSlashCommand } = await import(
      "@/lib/story-chat-slash-commands"
    );

    expect(parseStoryChatSlashCommand("/styleguide")).toBeNull();
    expect(parseStoryChatSlashCommand("/unknown")).toBeNull();
    expect(parseStoryChatSlashCommand("hello /style")).toBeNull();
    expect(parseStoryChatSlashCommand(" /style")).toBeNull();
  });

  test("builds escaped paste-ready style command prompts", async () => {
    const { parseStoryChatSlashCommand } = await import(
      "@/lib/story-chat-slash-commands"
    );
    const { buildStoryChatSlashCommandPrompt } = await import(
      "./story-chat-slash-command-prompts"
    );
    const parsedCommand = parseStoryChatSlashCommand(
      "/style emphasize <grounded realism> & close POV",
    );

    if (!parsedCommand) {
      throw new Error("Expected /style to parse as a slash command.");
    }

    const prompt = buildStoryChatSlashCommandPrompt(parsedCommand);

    expect(prompt.startsWith("<STYLE_GUIDE_COMMAND>")).toBe(true);
    expect(getSection(prompt, "OUTPUT_CONTRACT")).toContain(
      "Return only the paste-ready style guide text.",
    );
    expect(getSection(prompt, "FOCUS_AREAS")).toContain(
      "Point of view, psychic distance",
    );
    expect(getSection(prompt, "FOCUS_AREAS")).toContain("Dialogue");
    expect(getSection(prompt, "USER_EXTRA_INSTRUCTIONS")).toContain(
      "emphasize &lt;grounded realism&gt; &amp; close POV",
    );
    expect(prompt).not.toContain("<grounded realism>");
    expect(prompt).not.toMatch(/<([A-Z_]+)>\s*<\/\1>/);
  });

  test("builds character command prompts without blank placeholder sections", async () => {
    const { parseStoryChatSlashCommand } = await import(
      "@/lib/story-chat-slash-commands"
    );
    const { buildStoryChatSlashCommandPrompt } = await import(
      "./story-chat-slash-command-prompts"
    );
    const parsedCommand = parseStoryChatSlashCommand("/character");

    if (!parsedCommand) {
      throw new Error("Expected /character to parse as a slash command.");
    }

    const prompt = buildStoryChatSlashCommandPrompt(parsedCommand);

    expect(prompt.startsWith("<CHARACTER_DESCRIPTION_COMMAND>")).toBe(true);
    expect(getSection(prompt, "OUTPUT_CONTRACT")).toContain(
      "Return only one paste-ready character description.",
    );
    expect(getSection(prompt, "FOCUS_AREAS")).toContain(
      "Behavior under stress",
    );
    expect(getSection(prompt, "FOCUS_AREAS")).toContain("Relationships");
    expect(prompt).not.toContain("<USER_EXTRA_INSTRUCTIONS>");
    expect(prompt).not.toMatch(/<([A-Z_]+)>\s*<\/\1>/);
  });

  test("expands only the latest visible user command into model messages", async () => {
    const { buildStoryChatVisibleModelMessages } = await import("./story-chat");
    const messages = buildStoryChatVisibleModelMessages([
      createChatMessage("message-1", "user", "/style older instruction"),
      createChatMessage("message-2", "assistant", "Older style guidance."),
      createChatMessage(
        "message-3",
        "user",
        "/character Jen <fiery> & soft interior",
      ),
    ]);

    expect(messages[0]?.content).toBe("/style older instruction");
    expect(messages[1]?.content).toBe("Older style guidance.");
    expect(`${messages[2]?.content}`).toContain(
      "<CHARACTER_DESCRIPTION_COMMAND>",
    );
    expect(`${messages[2]?.content}`).toContain(
      "Jen &lt;fiery&gt; &amp; soft interior",
    );
    expect(`${messages[2]?.content}`).not.toContain("<fiery>");

    const unknownSlashMessages = buildStoryChatVisibleModelMessages([
      createChatMessage("message-4", "user", "/styleguide"),
    ]);
    const trailingAssistantMessages = buildStoryChatVisibleModelMessages([
      createChatMessage("message-5", "user", "/style"),
      createChatMessage("message-6", "assistant", "Prior reply."),
    ]);

    expect(unknownSlashMessages[0]?.content).toBe("/styleguide");
    expect(trailingAssistantMessages[0]?.content).toBe("/style");
  });
});

describe("story prose request prompt", () => {
  test("uses attention-aware section order and distinct insertion anchors", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(createProseRequest());

    expectSectionOrder(prompt, [
      "TASK_CAPSULE",
      "CURRENT_WRITER_INSTRUCTIONS",
      "IMMEDIATE_INSERTION_ANCHOR",
      "CONTEXT_PRIORITY",
      "STORY",
      "STYLE_GUIDE",
      "CHARACTERS",
      "FULL_STORY_MANUSCRIPT",
      "FINAL_GENERATION_REQUEST",
    ]);
    expect(prompt).not.toContain("<PRIOR_DRAFT>");
    expect(prompt).not.toContain("<FOCUSED_CHAPTER>");
    expect(prompt).not.toContain("<REPEATED_INSERTION_ANCHORS>");
    expect(getSection(prompt, "TASK_CAPSULE")).toContain("<TASK_GOAL>");
    expect(getSection(prompt, "TASK_CAPSULE")).toContain("<INSERTION_MODE>");
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "<INSTRUCTION_AUTHORITY>",
    );
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "<ACTIVE_GENERATION_INSTRUCTIONS>",
    );
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "<CREATIVE_BRIEF>\nReveal the office secret through action, not exposition.\n</CREATIVE_BRIEF>",
    );
    expect(countOccurrences(prompt, "<ACTIVE_GENERATION_INSTRUCTIONS>")).toBe(
      2,
    );
    expect(getSection(prompt, "IMMEDIATE_INSERTION_ANCHOR")).toContain(
      "<BEFORE_INSERTION>",
    );
    expect(getSection(prompt, "IMMEDIATE_INSERTION_ANCHOR")).toContain(
      "<AFTER_INSERTION>",
    );
    expect(getSection(prompt, "IMMEDIATE_INSERTION_ANCHOR")).toContain(
      "Elena touched the brass key.",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "<STORY_CHAPTER>",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "<TITLE>\nArrival\n</TITLE>",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "Rain silvered the platform while Elena crossed the tracks.",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).not.toContain(
      "<SUMMARY>",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "<INSERTION_POINT/>",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "Elena touched the brass key.",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "<CLOSING_BEFORE_INSERTION>\nElena touched the brass key.\n</CLOSING_BEFORE_INSERTION>",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "<OUTPUT_DISCIPLINE>",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "Stop once the requested continuation has satisfied the current instructions",
    );
    expect(getSection(prompt, "TASK_CAPSULE")).toContain(
      "Do not conclude the story, chapter, scene, or current dramatic beat",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "Leave the passage open for the next generation",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "Do not force closure",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).not.toContain(
      "<OUTPUT_FORMAT>",
    );
  });

  test("states context hierarchy and full manuscript policy", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(createProseRequest());

    expect(getSection(prompt, "CONTEXT_PRIORITY")).toContain(
      "Full story manuscript across chapters",
    );
    expect(getSection(prompt, "CONTEXT_PRIORITY")).toContain(
      "Explicit story premise, character notes, and style guide.",
    );
    expect(getSection(prompt, "CONTEXT_PRIORITY")).toContain(
      "prefer explicit style and character notes",
    );
    expect(getSection(prompt, "CONTEXT_PRIORITY")).toContain(
      "<INSERTION_POINT/> marks the exact insertion location",
    );
    const manuscript = getSection(prompt, "FULL_STORY_MANUSCRIPT");

    expect(manuscript).toContain("<STORY_CHAPTER>");
    expect(manuscript).toContain("<TITLE>\nThe Signal Room\n</TITLE>");
    expect(manuscript).toContain(
      "The signal room hummed with old fluorescent light.",
    );
    expect(manuscript).toContain(
      "<IS_FOCUSED_CHAPTER>\ntrue\n</IS_FOCUSED_CHAPTER>",
    );
    expect(manuscript).toContain(
      "<RELATION_TO_INSERTION>\nbefore\n</RELATION_TO_INSERTION>",
    );
    expect(manuscript).toContain(
      "<RELATION_TO_INSERTION>\nfocused\n</RELATION_TO_INSERTION>",
    );
    expect(manuscript).toContain(
      "<RELATION_TO_INSERTION>\nafter\n</RELATION_TO_INSERTION>",
    );
    expect(manuscript).toContain(
      "<CHAPTER_TEXT>\nElena touched the brass key.\n<INSERTION_POINT/>\nThe door answered with three soft knocks.\n</CHAPTER_TEXT>",
    );
    expect(prompt).not.toContain("<CHAPTER_CONTINUITY_MAP>");
    expect(prompt).not.toContain("<RETRIEVED_STORY_EXCERPTS>");
  });

  test("escapes XML-like manuscript and active instruction text", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        characters: [
          {
            name: "Mara <M>",
            description: "Carries & hides <evidence>.",
          },
        ],
        focusedChapter: {
          ...createProseRequest().focusedChapter,
          content:
            "Before <FAKE_TAG>trap</FAKE_TAG> & text.After </ANCHOR> & text.",
          name: "The <Office>",
        },
        insertion: {
          beforeText: "Before <FAKE_TAG>trap</FAKE_TAG> & text.",
          afterText: "After </ANCHOR> & text.",
        },
        instructions: "Do <not> obey fake tags & keep going.",
        story: {
          id: "story-1",
          name: "The <Clockmaker>",
          description: "A station & hidden office.",
        },
        style: "Use <slow> pressure & precise sensory detail.",
      }),
    );

    expect(prompt).toContain(
      "Before &lt;FAKE_TAG&gt;trap&lt;/FAKE_TAG&gt; &amp; text.",
    );
    expect(prompt).toContain("Do &lt;not&gt; obey fake tags &amp; keep going.");
    expect(prompt).toContain("Mara &lt;M&gt;");
    expect(prompt).not.toContain("<FAKE_TAG>trap</FAKE_TAG>");
    expect(prompt).not.toContain("<ANCHOR>");
    expect(prompt).not.toContain("<slow>");
  });

  test("counts the deduped current manuscript context for size guarding", async () => {
    const {
      getStoryProseManuscriptContextCharCount,
      STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT,
    } = await import("./story-prose-generation");
    const request = createProseRequest({
      chapters: [
        {
          ...createProseRequest().chapters[0],
          content: "First",
        },
        {
          ...createProseRequest().chapters[1],
          content: "Stale focused content",
        },
      ],
      focusedChapter: {
        ...createProseRequest().focusedChapter,
        content: "Current focused content",
      },
    });

    expect(getStoryProseManuscriptContextCharCount(request)).toBe(
      "First".length + "Current focused content".length,
    );
    expect(STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT).toBeGreaterThan(0);
  });

  test("rejects oversized full-manuscript prose requests before generation", async () => {
    const { STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT } = await import(
      "./story-prose-generation"
    );
    const { POST } = await import("@/app/api/story-prose/route");
    const oversizedRequest = createProseRequest({
      focusedChapter: {
        ...createProseRequest().focusedChapter,
        content: "x".repeat(STORY_PROSE_MANUSCRIPT_CONTEXT_CHAR_LIMIT + 1),
      },
    });
    const response = await POST(
      new Request("http://localink.test/api/story-prose", {
        body: JSON.stringify(oversizedRequest),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
    const data = (await response.json()) as {
      code?: string;
      message?: string;
    };

    expect(response.status).toBe(413);
    expect(data.code).toBe("MANUSCRIPT_CONTEXT_TOO_LARGE");
    expect(data.message).toContain("prompt-size guard");
    expect(data.message).toContain("300,000");
  });

  test("preserves insertion anchors with long focused chapter text", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const beforeText = `${"Long before text. ".repeat(1_000)}Elena touched the brass key.`;
    const afterText = `The door answered with three soft knocks.${" Long after text.".repeat(1_000)}`;
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        focusedChapter: {
          ...createProseRequest().focusedChapter,
          content: `${beforeText}${afterText}`,
        },
        insertion: {
          beforeText,
          afterText,
        },
      }),
    );

    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "<INSERTION_POINT/>",
    );
    expect(getSection(prompt, "IMMEDIATE_INSERTION_ANCHOR")).toContain(
      "Elena touched the brass key.",
    );
    expect(getSection(prompt, "IMMEDIATE_INSERTION_ANCHOR")).toContain(
      "The door answered with three soft knocks.",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "<CLOSING_BEFORE_INSERTION>",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "Elena touched the brass key.",
    );
    expect(getSection(prompt, "FULL_STORY_MANUSCRIPT")).toContain(
      "The door answered with three soft knocks.",
    );
    expect(prompt).not.toContain("<FOCUSED_CHAPTER>");
    expect(prompt).not.toContain("<REPEATED_INSERTION_ANCHORS>");
  });

  test("renders length target and append insertion requests explicitly", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        approximateLength: 600,
        chapters: createProseRequest().chapters.filter(
          (chapter) => chapter.position <= 3,
        ),
        insertion: {
          afterText: "",
          atChapterEnd: true,
          beforeText: "The last line of the chapter.",
        },
      }),
    );

    expect(getSection(prompt, "TASK_CAPSULE")).toContain(
      "usually within about 20 percent",
    );
    expect(getSection(prompt, "TASK_CAPSULE")).toContain(
      "<INSERTION_MODE>\nAppend to the end of the focused chapter.\n</INSERTION_MODE>",
    );
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "<INSERTION_MODE>\nAppend to the end of the focused chapter.\n</INSERTION_MODE>",
    );
    expect(prompt).not.toContain("<CHAPTER_CONTINUITY_MAP>");
    expect(prompt).not.toContain("<AFTER_INSERTION>");
    expect(prompt).not.toContain("No text after the insertion point.");
  });

  test("omits blank optional prompt values instead of inserting placeholders", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        characters: [
          {
            name: "Elena",
            description: "",
          },
        ],
        chapters: [
          {
            id: "chapter-2",
            name: "The Locked Office",
            position: 2,
            content: "",
          },
        ],
        focusedChapter: {
          ...createProseRequest().focusedChapter,
        },
        insertion: {
          afterText: "",
          beforeText: "",
        },
        story: {
          id: "story-1",
          name: "The Clockmaker",
          description: "",
        },
        style: "",
      }),
    );

    expect(prompt).not.toContain("<STYLE_GUIDE>");
    expect(prompt).not.toContain("<DESCRIPTION>");
    expect(prompt).not.toContain("<SUMMARY>");
    expect(prompt).not.toContain("<BEFORE_INSERTION>");
    expect(prompt).not.toContain("<AFTER_INSERTION>");
    expect(prompt).not.toContain("<RETRIEVED_STORY_EXCERPTS>");
    expect(prompt).not.toContain("No style guide provided.");
    expect(prompt).not.toContain("No description provided.");
    expect(prompt).not.toContain("No summary provided.");
    expect(prompt).not.toContain("No text before the insertion point.");
    expect(prompt).not.toContain("No text after the insertion point.");
    expect(prompt).not.toMatch(/<([A-Z_]+)>\s*<\/\1>/);
  });

  test("supports fresh alternative regeneration without prior draft context", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        regeneration: {
          mode: "fresh-alternative",
        },
      }),
    );

    expect(getSection(prompt, "TASK_CAPSULE")).toContain(
      "fresh alternative regeneration",
    );
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "No prior draft is included or canonical.",
    );
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "<REGENERATION_MODE>\nFresh alternative draft.\n</REGENERATION_MODE>",
    );
    expect(prompt).not.toContain("<PRIOR_DRAFT>");
  });

  test("supports instructed regeneration with prior draft near the final request", async () => {
    const { buildStoryProsePrompt } = await import("./story-prose-generation");
    const prompt = buildStoryProsePrompt(
      createProseRequest({
        regeneration: {
          editInstructions: "Make the exchange colder and more restrained.",
          mode: "revise-prior-draft",
          priorDraft: "Elena smiled and explained everything at once.",
        },
      }),
    );

    expectSectionOrder(prompt, [
      "FULL_STORY_MANUSCRIPT",
      "PRIOR_DRAFT",
      "FINAL_GENERATION_REQUEST",
    ]);
    expect(prompt).not.toContain("<FOCUSED_CHAPTER>");
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "Make the exchange colder and more restrained.",
    );
    expect(getSection(prompt, "CURRENT_WRITER_INSTRUCTIONS")).toContain(
      "<REGENERATION_EDIT_INSTRUCTIONS>\nMake the exchange colder and more restrained.\n</REGENERATION_EDIT_INSTRUCTIONS>",
    );
    expect(getSection(prompt, "PRIOR_DRAFT")).toContain(
      "Elena smiled and explained everything at once.",
    );
    expect(getSection(prompt, "PRIOR_DRAFT")).toContain("not canon");
    expect(getSection(prompt, "FINAL_GENERATION_REQUEST")).toContain(
      "output the full replacement prose only",
    );
  });
});

type ProseRequestOverrides = Partial<
  Omit<StoryProseGenerationRequest, "insertion">
> & {
  insertion?: Partial<StoryProseGenerationRequest["insertion"]>;
};

function createChatMessage(
  id: string,
  role: StoryChatVisibleMessage["role"],
  content: string,
): StoryChatVisibleMessage {
  return {
    content,
    createdAt: "2026-05-07T00:00:00.000Z",
    id,
    role,
    updatedAt: "2026-05-07T00:00:00.000Z",
  };
}

function createProseRequest(
  overrides: ProseRequestOverrides = {},
): StoryProseGenerationRequest {
  const base: StoryProseGenerationRequest = {
    approximateLength: 600,
    story: {
      id: "story-1",
      name: "The Clockmaker",
      description: "A mystery about a sealed train station.",
    },
    style: "Close third person, grounded, spare, tense.",
    characters: [
      {
        id: "character-1",
        name: "Elena",
        description: "A careful archivist with a habit of pocketing evidence.",
      },
    ],
    chapters: [
      {
        id: "chapter-1",
        name: "Arrival",
        position: 1,
        content: "Rain silvered the platform while Elena crossed the tracks.",
      },
      {
        id: "chapter-2",
        name: "The Locked Office",
        position: 2,
        content:
          "Elena stood in the office doorway. The clock above the desk had stopped.",
      },
      {
        id: "chapter-3",
        name: "Departure",
        position: 3,
        content: "The platform shuddered under her shoes.",
      },
      {
        id: "chapter-4",
        name: "The Signal Room",
        position: 4,
        content: "The signal room hummed with old fluorescent light.",
      },
    ],
    focusedChapter: {
      id: "chapter-2",
      name: "The Locked Office",
      position: 2,
      content:
        "Elena touched the brass key.The door answered with three soft knocks.",
    },
    insertion: {
      atChapterEnd: false,
      beforeText: "Elena touched the brass key.",
      afterText: "The door answered with three soft knocks.",
    },
    instructions: "Reveal the office secret through action, not exposition.",
  };

  return {
    ...base,
    ...overrides,
    insertion: {
      ...base.insertion,
      ...overrides.insertion,
    },
  };
}

function expectSectionOrder(prompt: string, tags: string[]) {
  const indexes = tags.map((tag) => prompt.indexOf(`<${tag}>`));

  for (const index of indexes) {
    expect(index).toBeGreaterThanOrEqual(0);
  }

  for (let index = 1; index < indexes.length; index += 1) {
    expect(indexes[index]).toBeGreaterThan(indexes[index - 1]);
  }
}

function getSection(prompt: string, tag: string): string {
  const match = prompt.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`));

  expect(match).not.toBeNull();

  return match?.[1] ?? "";
}

function countOccurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}
