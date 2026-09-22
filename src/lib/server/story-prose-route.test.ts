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
    mock.module("@/lib/ai", () => ({
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
