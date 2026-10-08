// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Isolate module replacements so the actual route can be exercised without
// touching the user's database/settings or contaminating other helper tests.
test("prose route hydrates caches, budgets rendered context, and preserves incomplete output", () => {
  const script = `
    import { mock } from "bun:test";
    import { Database } from "bun:sqlite";
    import { drizzle } from "drizzle-orm/bun-sqlite";
    mock.module("server-only", () => ({}));
    const client = new Database(":memory:");
    client.exec("CREATE TABLE chapters (id TEXT PRIMARY KEY, story_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, content TEXT NOT NULL, synopsis TEXT NOT NULL, synopsis_source_hash TEXT NOT NULL)");
    const db = drizzle(client);
    mock.module("@/lib/drizzle/db", () => ({ getDb: () => db }));
    mock.module("@/lib/server/app-settings", () => ({ getAppSettings: async () => ({ systemInstructions: "Write plainly." }) }));
    mock.module("@/lib/logger", () => ({ createLogger: () => ({ info() {}, error() {} }) }));
    let calls = [];
    let finishReason = "stop";
    const { STORY_GENERATION_AI_MODELS } = await import("@/lib/ai");
    mock.module("@/lib/ai", () => ({
      STORY_GENERATION_AI_MODELS,
      isOpenRouterZdrUnavailableError: () => false,
      generateLocalinkText: () => { throw new Error("Unexpected synopsis generation"); },
      streamLocalinkText: (options) => {
        calls.push(options);
        return { fullStream: (async function* () {
          yield { type: "text-delta", text: "The door opened." };
          yield { type: "finish", finishReason };
        })() };
      },
    }));
    const { getChapterSynopsisSourceHash } = await import("@/lib/server/story-chapter-synopses");
    const { POST } = await import("@/app/api/story-prose/route");
    const { readLocalinkTextStream } = await import("@/lib/ai-text-stream");
    const content = "Manuscript detail. ".repeat(2500);
    const chapters = Array.from({ length: 40 }, (_, i) => {
      const chapter = { id: "chapter-" + i, name: "Chapter " + i, position: i + 1, content, synopsis: "Browser-supplied fiction must be ignored." };
      client.query("INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?)").run(chapter.id, "story", chapter.name, chapter.position, content, "Verified fact " + i, getChapterSynopsisSourceHash(content));
      return chapter;
    });
    const focusedChapter = { id: "focused", name: "Focused", position: 41, content: "She waited.", synopsis: "False future revelation." };
    const input = {
      story: { id: "story", name: "Story", description: "", systemInstructions: "" },
      chapters, focusedChapter, style: "", characters: [], locations: [], voiceExemplars: [],
      insertion: { beforeText: "She waited.", afterText: "", selectedText: "", atChapterEnd: true },
      instructions: "Open the door.", approximateLength: 400, pacing: "auto", beatGoal: "",
    };
    const post = (body) => POST(new Request("http://localink.test/api/story-prose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const normal = await post(input);
    let normalText = "";
    await readLocalinkTextStream(normal, { onDelta: (text) => normalText += text, incompleteMessage: "Incomplete", unavailableMessage: "Unavailable" });
    const normalOptions = calls[0];
    const oversized = await post({ ...input, insertion: { ...input.insertion, selectedText: "x".repeat(700000), isRewrite: true } });
    const oversizedBody = await oversized.json();
    const callsAfterOversized = calls.length;
    finishReason = "length";
    const partial = await post(input);
    let partialText = "";
    let partialError;
    try {
      await readLocalinkTextStream(partial, { onDelta: (text) => partialText += text, incompleteMessage: "Incomplete", unavailableMessage: "Unavailable" });
    } catch (error) { partialError = error.code; }
    client.close();
    console.log(JSON.stringify({
      normalStatus: normal.status, normalText,
      rawManuscriptSize: content.length * chapters.length,
      usesServerSummary: normalOptions.prompt.includes("Verified fact 0"),
      ignoresBrowserSummary: !normalOptions.prompt.includes("Browser-supplied fiction") && !normalOptions.prompt.includes("False future revelation"),
      maxOutputTokens: normalOptions.maxOutputTokens,
      snapshotAvailable: Boolean(normal.headers.get("X-Prose-Prompt-Snapshot-Id")),
      oversizedStatus: oversized.status, oversizedCode: oversizedBody.code, callsAfterOversized,
      partialText, partialError,
    }));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout);
  expect(output.rawManuscriptSize).toBeGreaterThan(1_500_000);
  expect(output).toMatchObject({
    normalStatus: 200,
    normalText: "The door opened.",
    usesServerSummary: true,
    ignoresBrowserSummary: true,
    maxOutputTokens: 1_200,
    snapshotAvailable: true,
    oversizedStatus: 413,
    oversizedCode: "MANUSCRIPT_CONTEXT_TOO_LARGE",
    callsAfterOversized: 1,
    partialText: "The door opened.",
    partialError: "STREAM_OUTPUT_LIMIT",
  });
});

test("prose route selects per-request models, output limits, and regeneration settings", () => {
  const script = `
    import { mock } from "bun:test";
    mock.module("server-only", () => ({}));
    mock.module("@/lib/logger", () => ({ createLogger: () => ({ info() {}, error() {} }) }));
    mock.module("@/lib/server/app-settings", () => ({ getAppSettings: async () => ({ systemInstructions: "Write plainly." }) }));
    let preparedCount = 0;
    mock.module("@/lib/server/story-prose-context", () => ({ prepareStoryProseContext: async (input) => {
      preparedCount++;
      return { ...input, synopsisProvenance: new Map() };
    } }));
    mock.module("@/lib/server/story-prose-prompt-snapshots", () => ({ saveStoryProsePromptSnapshot: () => ({ id: "snapshot" }) }));
    const { STORY_GENERATION_AI_MODELS } = await import("@/lib/ai");
    const calls = [];
    mock.module("@/lib/ai", () => ({
      STORY_GENERATION_AI_MODELS,
      isOpenRouterZdrUnavailableError: () => false,
      streamLocalinkText: (options) => {
        calls.push(options);
        return { fullStream: (async function* () {
          yield { type: "reasoning-delta", text: "Hidden drafting thoughts." };
          yield { type: "text-delta", text: "The door opened." };
          yield { type: "finish", finishReason: "stop" };
        })() };
      },
    }));
    const { POST } = await import("@/app/api/story-prose/route");
    const { readLocalinkTextStream } = await import("@/lib/ai-text-stream");
    const { storyProseGenerationRequestSchema } = await import("@/lib/story-prose-generation-contract");
    const { buildBudgetedStoryProsePrompt, buildStoryProseSystemPrompt } = await import("@/lib/server/story-prose-generation");
    const input = {
      story: { id: "story", name: "Story", description: "", systemInstructions: "" },
      chapters: [], focusedChapter: { id: "focused", name: "Focused", position: 1, content: "She waited." },
      style: "", characters: [], locations: [], voiceExemplars: [],
      insertion: { beforeText: "She waited.", afterText: "", selectedText: "", atChapterEnd: true },
      instructions: "Open the door.", approximateLength: "unlimited", pacing: "auto", beatGoal: "",
    };
    const post = (body) => POST(new Request("http://localink.test/api/story-prose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const invoke = async (body) => { const response = await post(body); await response.text(); return response.status; };
    const statuses = [];
    for (const model of ["deepseekV4Pro", "kimiK3", "glm53", "mistralLarge40"]) {
      statuses.push(await invoke({ ...input, model }));
      statuses.push(await invoke({ ...input, model, regeneration: { mode: "fresh-alternative", priorAttempt: "A prior attempt." } }));
      statuses.push(await invoke({ ...input, model, regeneration: { mode: "revise-prior-draft", priorDraft: "A draft.", editInstructions: "Make it quieter." } }));
    }
    const selectedCalls = calls.map(({ model, temperature, providerOptions, maxOutputTokens }) => ({ model, temperature, providerOptions, maxOutputTokens }));
    const boundedCalls = [];
    for (const model of ["deepseekV4Pro", "kimiK3", "glm53", "mistralLarge40", undefined]) {
      for (const approximateLength of [200, 400, 600, 1000]) {
        const response = await post({ ...input, model, approximateLength });
        let text = "";
        await readLocalinkTextStream(response, { onDelta: (delta) => text += delta, incompleteMessage: "Incomplete", unavailableMessage: "Unavailable" });
        boundedCalls.push({ model: model ?? "default", approximateLength, maxOutputTokens: calls.at(-1).maxOutputTokens, text, status: response.status });
      }
    }
    await invoke(input);
    const defaultModel = calls.at(-1).model;
    const beforeInvalid = calls.length;
    const preparedBeforeInvalid = preparedCount;
    const invalid = await post({ ...input, model: "unknown" });
    const invalidBody = await invalid.json();
    const invalidInvokedModel = calls.length !== beforeInvalid;
    const invalidPreparedContext = preparedCount !== preparedBeforeInvalid;
    // A fixed selection that fits DeepSeek's context must fail against Mistral's
    // smaller context before streaming, even with the same short output target.
    // The selection appears twice in the prompt, budgeting over 600k tokens.
    const large = { ...input, approximateLength: 200, insertion: { ...input.insertion, selectedText: "x".repeat(300000), isRewrite: true } };
    const deepseekLargeStatus = await invoke({ ...large, model: "deepseekV4Pro" });
    const callsBeforeMistral = calls.length;
    const mistralLarge = await post({ ...large, model: "mistralLarge40" });
    const mistralLargeBody = await mistralLarge.json();
    const mistralLargeInvokedModel = calls.length !== callsBeforeMistral;
    // Hold fixed context just below the shared Kimi/GLM ceiling. It leaves
    // room for the prose target, but not GLM's additional reasoning allowance.
    const boundedInput = storyProseGenerationRequestSchema.parse({ ...input, approximateLength: 200 });
    const { inputTokenUpperBound } = buildBudgetedStoryProsePrompt({ ...boundedInput, synopsisProvenance: new Map() }, {
      system: buildStoryProseSystemPrompt("Write plainly.", ""),
      contextWindowTokens: 1048576, maxCompletionTokens: 131072, requestedOutputTokens: 700,
    });
    const nearCeiling = { ...boundedInput, style: "x".repeat(1048576 - inputTokenUpperBound - 2000) };
    const kimiNearCeilingStatus = await invoke({ ...nearCeiling, model: "kimiK3" });
    const callsBeforeGlmCeiling = calls.length;
    const glmNearCeiling = await post({ ...nearCeiling, model: "glm53" });
    const glmNearCeilingBody = await glmNearCeiling.json();
    console.log(JSON.stringify({ statuses, selectedCalls, boundedCalls, defaultModel,
      invalidStatus: invalid.status, invalidCode: invalidBody.code, invalidInvokedModel, invalidPreparedContext,
      deepseekLargeStatus, mistralLargeStatus: mistralLarge.status, mistralLargeCode: mistralLargeBody.code,
      mistralLargeInvokedModel,
      kimiNearCeilingStatus, glmNearCeilingStatus: glmNearCeiling.status, glmNearCeilingCode: glmNearCeilingBody.code,
      glmNearCeilingInvokedModel: calls.length !== callsBeforeGlmCeiling,
    }));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout);
  expect(output.statuses).toEqual(Array(12).fill(200));
  const profiles = [
    ["prose-deepseek-v4-pro", 384_000],
    ["prose-kimi-k3", 943_718],
    ["prose-glm-5.3", 131_072],
    ["prose-mistral-large-4.0", 262_144],
  ];
  for (let index = 0; index < profiles.length; index++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const call = output.selectedCalls[index * 3 + attempt];
      expect(call).toMatchObject({
        model: profiles[index][0],
        maxOutputTokens: profiles[index][1],
        providerOptions: {
          openrouter: {
            reasoning: { effort: index === 2 ? "low" : "none", exclude: true },
          },
        },
      });
      expect(call.temperature).toBeCloseTo(attempt === 1 ? 0.95 : 0.82);
    }
  }
  const outputLimits: Record<number, number> = {
    200: 700,
    400: 1_200,
    600: 1_700,
    1000: 2_700,
  };
  const glmOutputLimits: Record<number, number> = {
    200: 4_796,
    400: 5_296,
    600: 5_796,
    1000: 6_796,
  };
  expect(output.boundedCalls).toHaveLength(20);
  for (const call of output.boundedCalls) {
    expect(call).toMatchObject({
      maxOutputTokens: (call.model === "glm53"
        ? glmOutputLimits
        : outputLimits)[call.approximateLength],
      text: "The door opened.",
      status: 200,
    });
  }
  expect(output).toMatchObject({
    defaultModel: "prose-deepseek-v4-pro",
    invalidStatus: 400,
    invalidCode: "BAD_REQUEST",
    invalidInvokedModel: false,
    invalidPreparedContext: false,
    deepseekLargeStatus: 200,
    mistralLargeStatus: 413,
    mistralLargeCode: "MANUSCRIPT_CONTEXT_TOO_LARGE",
    mistralLargeInvokedModel: false,
    kimiNearCeilingStatus: 200,
    glmNearCeilingStatus: 413,
    glmNearCeilingCode: "MANUSCRIPT_CONTEXT_TOO_LARGE",
    glmNearCeilingInvokedModel: false,
  });
});
