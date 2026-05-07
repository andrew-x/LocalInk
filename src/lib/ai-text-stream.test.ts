// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import type { LocalinkTextStreamError } from "./ai-text-stream";
import {
  encodeLocalinkTextStreamEvent,
  readLocalinkTextStream,
} from "./ai-text-stream";

describe("LocalInk text stream events", () => {
  test("reads text deltas only after a complete event", async () => {
    const chunks: string[] = [];
    const response = new Response(
      [
        encodeLocalinkTextStreamEvent({ text: "First ", type: "delta" }),
        encodeLocalinkTextStreamEvent({ text: "second.", type: "delta" }),
        encodeLocalinkTextStreamEvent({ type: "complete" }),
      ].join(""),
    );

    await readLocalinkTextStream(response, {
      incompleteMessage: "Incomplete.",
      unavailableMessage: "Unavailable.",
      onDelta(text) {
        chunks.push(text);
      },
    });

    expect(chunks.join("")).toBe("First second.");
  });

  test("throws sanitized route errors from the stream", async () => {
    const response = new Response(
      encodeLocalinkTextStreamEvent({
        code: "GENERATION_FAILED",
        message: "The prose could not be generated.",
        type: "error",
      }),
    );

    await expect(
      readLocalinkTextStream(response, {
        incompleteMessage: "Incomplete.",
        unavailableMessage: "Unavailable.",
        onDelta() {},
      }),
    ).rejects.toMatchObject({
      code: "GENERATION_FAILED",
      message: "The prose could not be generated.",
      name: "LocalinkTextStreamError",
    } satisfies Partial<LocalinkTextStreamError>);
  });

  test("rejects streams that end without a complete event", async () => {
    const response = new Response(
      encodeLocalinkTextStreamEvent({ text: "Partial text.", type: "delta" }),
    );

    await expect(
      readLocalinkTextStream(response, {
        incompleteMessage: "The stream ended early.",
        unavailableMessage: "Unavailable.",
        onDelta() {},
      }),
    ).rejects.toMatchObject({
      code: "STREAM_INCOMPLETE",
      message: "The stream ended early.",
    } satisfies Partial<LocalinkTextStreamError>);
  });
});
