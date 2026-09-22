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
        encodeLocalinkTextStreamEvent({
          finishReason: "stop",
          type: "complete",
        }),
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

describe("text stream protocol validation", () => {
  for (const terminal of [
    '{"type":"complete"}\n',
    '{"type":"complete","finishReason":"length"}\n',
    "not-json\n",
    '{"type":"error","code":"STREAM_FAILED","message":"Failed.","finishReason":"stop"}\n',
  ]) {
    test(`rejects invalid terminal ${terminal.trim()}`, async () => {
      await expect(
        readLocalinkTextStream(new Response(terminal), {
          incompleteMessage: "Incomplete.",
          unavailableMessage: "Unavailable.",
          onDelta() {},
        }),
      ).rejects.toMatchObject({ code: "STREAM_INVALID" });
    });
  }

  test("does not accept text after a terminal success", async () => {
    const chunks: string[] = [];
    const response = new Response(
      encodeLocalinkTextStreamEvent({
        finishReason: "stop",
        type: "complete",
      }) +
        encodeLocalinkTextStreamEvent({ text: "Unexpected.", type: "delta" }),
    );
    await expect(
      readLocalinkTextStream(response, {
        incompleteMessage: "Incomplete.",
        unavailableMessage: "Unavailable.",
        onDelta(text) {
          chunks.push(text);
        },
      }),
    ).rejects.toMatchObject({ code: "STREAM_INVALID" });
    expect(chunks).toEqual([]);
    expect(response.body?.locked).toBe(false);
  });

  test("decodes Unicode split across byte chunks and a final line without newline", async () => {
    const encoded = new TextEncoder().encode(
      encodeLocalinkTextStreamEvent({ text: "é中🖋", type: "delta" }) +
        JSON.stringify({ finishReason: "stop", type: "complete" }),
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
    );
    const chunks: string[] = [];
    await readLocalinkTextStream(response, {
      incompleteMessage: "Incomplete.",
      unavailableMessage: "Unavailable.",
      onDelta(text) {
        chunks.push(text);
      },
    });
    expect(chunks.join("")).toBe("é中🖋");
    expect(response.body?.locked).toBe(false);
  });
});
