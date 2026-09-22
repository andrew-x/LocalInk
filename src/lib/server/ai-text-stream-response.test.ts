// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";

import {
  isLocalinkIncompleteFinish,
  LocalinkTextStreamFinishError,
  readLocalinkTextStream,
} from "../ai-text-stream";

mock.module("server-only", () => ({}));

const { toLocalinkTextStreamResponse } = await import(
  "./ai-text-stream-response"
);

type StreamPart = {
  error?: unknown;
  finishReason?: string;
  text?: string;
  type: string;
};

function createResponse(
  parts: StreamPart[] | AsyncIterable<StreamPart>,
  requestSignal?: AbortSignal,
) {
  const callbacks = { abort: 0, complete: 0, errors: [] as string[] };
  const response = toLocalinkTextStreamResponse({
    stream: {
      fullStream: (async function* () {
        for await (const part of parts) yield part;
      })(),
    },
    requestSignal,
    onAbort() {
      callbacks.abort++;
    },
    onComplete() {
      callbacks.complete++;
    },
    onError(_error, routeError) {
      callbacks.errors.push(routeError.code);
    },
    toRouteError(error) {
      return error instanceof LocalinkTextStreamFinishError
        ? { code: error.code, message: error.message }
        : { code: "GENERATION_FAILED", message: "Generation failed." };
    },
  });
  return { response, callbacks };
}

async function consume(response: Response) {
  const chunks: string[] = [];
  let error: unknown;
  try {
    await readLocalinkTextStream(response, {
      incompleteMessage: "Incomplete stream.",
      unavailableMessage: "Unavailable stream.",
      onDelta(text) {
        chunks.push(text);
      },
    });
  } catch (caught) {
    error = caught;
  }
  return { text: chunks.join(""), error };
}

const partial: StreamPart = { type: "text-delta", text: "Partial prose." };

describe("text stream adapter and reader", () => {
  test("only a normal stop completes and preserves its finish reason", async () => {
    const { response, callbacks } = createResponse([
      partial,
      { type: "finish", finishReason: "stop" },
    ]);
    const wire = response.clone();
    expect(await consume(response)).toEqual({
      text: "Partial prose.",
      error: undefined,
    });
    expect(await wire.text()).toContain('"finishReason":"stop"');
    expect(callbacks).toEqual({ abort: 0, complete: 1, errors: [] });
  });

  for (const [reason, code, incomplete] of [
    ["length", "STREAM_OUTPUT_LIMIT", true],
    ["content-filter", "STREAM_CONTENT_FILTERED", true],
    ["tool-calls", "STREAM_INCOMPLETE", true],
    ["other", "STREAM_INCOMPLETE", true],
    ["unknown", "STREAM_INCOMPLETE", true],
    [undefined, "STREAM_INCOMPLETE", true],
    ["error", "STREAM_FAILED", false],
  ] as const) {
    test(`retains partial text for ${reason ?? "missing"} finish reason`, async () => {
      const { response, callbacks } = createResponse([
        partial,
        { type: "finish", finishReason: reason },
      ]);
      const { text, error } = await consume(response);
      expect(text).toBe("Partial prose.");
      expect(error).toBeInstanceOf(LocalinkTextStreamFinishError);
      expect(error).toMatchObject({ code, finishReason: reason });
      expect(isLocalinkIncompleteFinish(error)).toBe(incomplete);
      expect(callbacks).toEqual({ abort: 0, complete: 0, errors: [code] });
    });
  }

  test("normalizes unexpected finish values without forwarding provider details", async () => {
    const { response } = createResponse([
      partial,
      { type: "finish", finishReason: "private provider diagnostic" },
    ]);
    const wire = response.clone();
    const { error } = await consume(response);
    expect(error).toMatchObject({
      code: "STREAM_INCOMPLETE",
      finishReason: "unknown",
    });
    expect(await wire.text()).not.toContain("private provider diagnostic");
  });

  test("missing terminal events are incomplete failures", async () => {
    const { response, callbacks } = createResponse([partial]);
    const { text, error } = await consume(response);
    expect(text).toBe("Partial prose.");
    expect(error).toMatchObject({ code: "STREAM_INCOMPLETE" });
    expect(callbacks).toEqual({
      abort: 0,
      complete: 0,
      errors: ["STREAM_INCOMPLETE"],
    });
  });

  test("provider errors retain their sanitized route error", async () => {
    const { response, callbacks } = createResponse([
      partial,
      { type: "error", error: new Error("private diagnostic") },
    ]);
    const { text, error } = await consume(response);
    expect(text).toBe("Partial prose.");
    expect(error).toMatchObject({
      code: "GENERATION_FAILED",
      message: "Generation failed.",
    });
    expect(isLocalinkIncompleteFinish(error)).toBe(false);
    expect(callbacks).toEqual({
      abort: 0,
      complete: 0,
      errors: ["GENERATION_FAILED"],
    });
  });

  test("explicit aborts are separate from incomplete output and errors", async () => {
    const { response, callbacks } = createResponse([
      partial,
      { type: "abort" },
    ]);
    const { text, error } = await consume(response);
    expect(text).toBe("Partial prose.");
    expect(error).toMatchObject({ code: "STREAM_ABORTED" });
    expect(isLocalinkIncompleteFinish(error)).toBe(false);
    expect(callbacks).toEqual({ abort: 1, complete: 0, errors: [] });
  });

  test("an aborted request cannot report a normal finish as complete", async () => {
    const controller = new AbortController();
    const { response, callbacks } = createResponse(
      (async function* () {
        yield partial;
        controller.abort();
        yield { type: "finish", finishReason: "stop" };
      })(),
      controller.signal,
    );
    const { error } = await consume(response);
    expect(error).toMatchObject({ code: "STREAM_ABORTED" });
    expect(callbacks).toEqual({ abort: 1, complete: 0, errors: [] });
  });

  test("a thrown abort is reported once without exposing errors", async () => {
    const controller = new AbortController();
    const { response, callbacks } = createResponse(
      (async function* () {
        yield partial;
        controller.abort();
        throw new Error("private abort diagnostic");
      })(),
      controller.signal,
    );
    expect((await consume(response)).error).toMatchObject({
      code: "STREAM_ABORTED",
    });
    expect(callbacks).toEqual({ abort: 1, complete: 0, errors: [] });
  });
});
