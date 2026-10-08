// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("chat route selects models while preserving settings and generation history inputs", () => {
  const script = `
    import { mock } from "bun:test";
    mock.module("server-only", () => ({}));
    mock.module("@/lib/logger", () => ({ createLogger: () => ({ info() {}, error() {} }) }));
    mock.module("@/lib/server/app-settings", () => ({ getAppSettings: async () => ({ systemInstructions: "Be direct." }) }));
    const historyInputs = [];
    const messages = [
      { role: "user", content: "First question." },
      { role: "assistant", content: "Earlier answer." },
      { role: "user", content: "A follow-up." },
    ];
    mock.module("@/lib/server/story-chat", () => ({
      buildStoryChatGenerationMessages: async (input) => { historyInputs.push(input); return messages; },
      buildStoryChatSystemPrompt: (instructions) => "System: " + instructions,
    }));
    const { STORY_GENERATION_AI_MODELS } = await import("@/lib/ai");
    const calls = [];
    mock.module("@/lib/ai", () => ({
      STORY_GENERATION_AI_MODELS,
      isOpenRouterZdrUnavailableError: () => false,
      streamLocalinkText: (options) => {
        calls.push(options);
        return { fullStream: (async function* () {
          yield { type: "text-delta", text: "A new reply." };
          yield { type: "finish", finishReason: "stop" };
        })() };
      },
    }));
    const { POST } = await import("@/app/api/story-chat/route");
    const { readLocalinkTextStream } = await import("@/lib/ai-text-stream");
    const input = { storyId: "story", chatId: "chat", generationId: "generation", contextMessageId: "context" };
    const post = (body) => POST(new Request("http://localink.test/api/story-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    const outcomes = [];
    for (const model of ["deepseekV4Pro", "kimiK3", "glm53", "mistralLarge40", undefined]) {
      const response = await post({ ...input, model });
      let text = "";
      await readLocalinkTextStream(response, { onDelta: (delta) => text += delta, incompleteMessage: "Incomplete", unavailableMessage: "Unavailable" });
      outcomes.push({ status: response.status, text });
    }
    // Regeneration selects the current model and passes the same saved-history
    // identifiers to the history builder, including the assistant being replaced.
    const regeneration = await post({ ...input, model: "kimiK3", replaceAssistantMessageId: "previous-assistant" });
    await regeneration.text();
    const callsBeforeInvalid = calls.length;
    const historiesBeforeInvalid = historyInputs.length;
    const invalid = await post({ ...input, model: "unknown" });
    const invalidBody = await invalid.json();
    console.log(JSON.stringify({ outcomes,
      calls: calls.map(({ model, temperature, system, providerOptions, messages: sentMessages }) => ({
        model, temperature, system, hasProviderOptions: providerOptions !== undefined, messages: sentMessages,
      })),
      historyInputs,
      invalidStatus: invalid.status, invalidCode: invalidBody.code,
      invalidInvokedModel: calls.length !== callsBeforeInvalid,
      invalidLoadedHistory: historyInputs.length !== historiesBeforeInvalid,
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
  expect(output.outcomes).toEqual(
    Array(5).fill({ status: 200, text: "A new reply." }),
  );
  expect(output.calls.map((call: { model: string }) => call.model)).toEqual([
    "prose-deepseek-v4-pro",
    "prose-kimi-k3",
    "prose-glm-5.3",
    "prose-mistral-large-4.0",
    "prose-deepseek-v4-pro",
    "prose-kimi-k3",
  ]);
  for (const call of output.calls) {
    expect(call).toMatchObject({
      temperature: 0.72,
      system: "System: Be direct.",
      hasProviderOptions: false,
      messages: [
        { role: "user", content: "First question." },
        { role: "assistant", content: "Earlier answer." },
        { role: "user", content: "A follow-up." },
      ],
    });
  }
  expect(output.historyInputs.at(-1)).toEqual({
    storyId: "story",
    chatId: "chat",
    generationId: "generation",
    contextMessageId: "context",
    replaceAssistantMessageId: "previous-assistant",
    model: "kimiK3",
  });
  expect(output).toMatchObject({
    invalidStatus: 400,
    invalidCode: "BAD_REQUEST",
    invalidInvokedModel: false,
    invalidLoadedHistory: false,
  });
});
