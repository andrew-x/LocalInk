// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import { storyChatStreamRequestSchema } from "./story-chat-contract";

const request = {
  storyId: "story",
  chatId: "chat",
  generationId: "generation",
  contextMessageId: "context",
};

describe("chat model selection contract", () => {
  test("defaults older requests to DeepSeek", () => {
    expect(storyChatStreamRequestSchema.parse(request).model).toBe(
      "deepseekV4Pro",
    );
  });

  test("accepts each supported model for messages and regeneration", () => {
    for (const model of [
      "deepseekV4Pro",
      "kimiK3",
      "glm53",
      "mistralMedium35",
    ]) {
      expect(
        storyChatStreamRequestSchema.parse({ ...request, model }).model,
      ).toBe(model);
      expect(
        storyChatStreamRequestSchema.parse({
          ...request,
          model,
          replaceAssistantMessageId: "previous-reply",
        }),
      ).toMatchObject({ model, replaceAssistantMessageId: "previous-reply" });
    }
  });

  test("rejects unsupported or malformed models instead of falling back", () => {
    for (const model of [
      "mistralai/mistral-large-4-0",
      "main",
      "__proto__",
      "",
      null,
      42,
    ]) {
      expect(
        storyChatStreamRequestSchema.safeParse({ ...request, model }).success,
      ).toBe(false);
    }
  });
});
