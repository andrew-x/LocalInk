import { ActionError } from "@/lib/action-error";
import {
  LOCALINK_TEXT_STREAM_CONTENT_TYPE,
  LocalinkTextStreamFinishError,
} from "@/lib/ai-text-stream";
import day from "@/lib/dayjs";
import { getSystemInstructions } from "@/lib/server/app-settings";
import type { StudioChatBundleCandidate } from "@/lib/server/studio/bundle-builder";
import { buildStudioChatHistory } from "@/lib/server/studio/chat-context";
import { createStudioChatGeneration } from "@/lib/server/studio/chat-generation";
import { StudioNotFoundError } from "@/lib/server/studio/prompt-kit";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";
import {
  chatStageBinding,
  loadStudioChatTurn,
  type StagedStudioChatTurn,
} from "@/lib/server/studio/repository-chat";
import {
  createStudioRouteLog,
  type StudioRouteError,
  studioErrorResponse,
  toStudioRouteError,
} from "@/lib/server/studio/route-kit";
import {
  beginStudioStage,
  failStudioStage,
  finishStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import {
  studioBundleOpsInputSchema,
  validateStudioBundleOps,
} from "@/lib/studio/bundle-contract";
import {
  type StudioChatContext,
  type StudioChatStep,
  type StudioChatStreamEvent,
  studioChatRequestSchema,
} from "@/lib/studio/chat-contract";
import { STUDIO_ASSIST_MODEL } from "@/lib/studio/models";

export const runtime = "nodejs";

const ACTION_NAME = "studio-chat-generate";

type RouteLog = ReturnType<typeof createStudioRouteLog>;
type Generation = ReturnType<typeof createStudioChatGeneration>;

/**
 * Streams one agent chat turn as NDJSON and stages the reply in server
 * memory on a `stop` finish; `saveStudioChatTurn` persists it. The body
 * carries ids and the context hints only: the user message is read from
 * the database by generationId. This route never writes the database.
 */
export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;
  let cleanup = () => {};

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The chat request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;
    ids.threadId = input.threadId;
    ids.generationId = input.generationId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const turn = loadStudioChatTurn(input);
    // The hint may name an item deleted since; skip it then.
    const itemIds = new Set(workspace.planItems.map((item) => item.id));
    const context: StudioChatContext = {
      lookingAtItemId:
        input.context.lookingAtItemId !== null &&
        itemIds.has(input.context.lookingAtItemId)
          ? input.context.lookingAtItemId
          : null,
    };
    log.start({
      model: STUDIO_ASSIST_MODEL,
      historyMessages: turn.messages.length - 1,
      lookingAt: context.lookingAtItemId !== null,
    });

    const globalInstructions = await getSystemInstructions();
    const stageBinding = chatStageBinding(input);
    const stageAttemptId = beginStudioStage(stageBinding);
    binding = stageBinding;
    attemptId = stageAttemptId;
    const proposedAt = day().toISOString();

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    cleanup = () => request.signal.removeEventListener("abort", abort);
    if (request.signal.aborted) abort();

    const progress: { send: ((step: StudioChatStep) => void) | null } = {
      send: null,
    };
    const generation = createStudioChatGeneration({
      workspace,
      context,
      history: buildStudioChatHistory(turn.messages, turn.bundles),
      globalInstructions,
      abortSignal: abortController.signal,
      onProgress: (step) => progress.send?.(step),
    });

    return toStudioChatResponse({
      generation,
      binding: stageBinding,
      attemptId: stageAttemptId,
      proposedAt,
      log,
      abortController,
      cleanup,
      progress,
    });
  } catch (error) {
    cleanup();
    if (binding && attemptId) failStudioStage(binding, attemptId);
    if (request.signal.aborted) {
      log.end("aborted");
      return new Response(null, { status: 499 });
    }
    const routeError = toStudioRouteError(error);
    log.error(error, routeError);
    log.end("error", routeError.code);
    return studioErrorResponse(routeError);
  }
}

/** The builder checks every call; this is a last guard before staging. */
function assertStageable(bundle: StudioChatBundleCandidate): void {
  const parsed = studioBundleOpsInputSchema.safeParse(bundle.operations);
  if (!parsed.success || validateStudioBundleOps(parsed.data).length > 0) {
    throw new ActionError(
      "GENERATION_FAILED",
      "The proposed changes could not be prepared. Try again.",
    );
  }
}

function toStudioChatResponse({
  generation,
  binding,
  attemptId,
  proposedAt,
  log,
  abortController,
  cleanup,
  progress,
}: {
  generation: Generation;
  binding: StudioStageBinding;
  attemptId: string;
  proposedAt: string;
  log: RouteLog;
  abortController: AbortController;
  cleanup: () => void;
  progress: { send: ((step: StudioChatStep) => void) | null };
}): Response {
  const encoder = new TextEncoder();
  const steps: StudioChatStep[] = [];
  let canceled = false;
  let terminated = false;
  let modelSteps = 0;
  let toolCalls = 0;
  const invalidCalls = new Set<string>();
  const details = () => ({
    model: generation.model,
    modelSteps,
    toolCalls,
    invalidToolCalls: invalidCalls.size,
    repairedToolCalls: generation.repairs.count,
    opCount: generation.builder.opCount,
    finalized: generation.builder.isFinalized,
  });
  const abort = () => {
    abortController.abort();
    failStudioStage(binding, attemptId);
    if (!terminated) log.end("aborted", undefined, details());
    terminated = true;
  };

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let content = "";
        let betweenSteps = false;
        const send = (event: StudioChatStreamEvent) => {
          if (!canceled) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
        };
        const addStep = (step: StudioChatStep) => {
          const last = steps.at(-1);
          if (last?.tool === step.tool && last.label === step.label) return;
          steps.push(step);
          send({ type: "step", tool: step.tool, label: step.label });
        };
        progress.send = addStep;
        try {
          for await (const part of generation.stream.fullStream) {
            if (canceled) return;
            if (abortController.signal.aborted || part.type === "abort") {
              abort();
              send({ type: "aborted" });
              return;
            }
            if (part.type === "text-delta") {
              if (betweenSteps && content && !content.endsWith("\n\n")) {
                content += "\n\n";
                send({ type: "delta", text: "\n\n" });
              }
              betweenSteps = false;
              content += part.text;
              send({ type: "delta", text: part.text });
            } else if (part.type === "tool-call") {
              // Tools report their own step when they start running.
              toolCalls += 1;
              if ("invalid" in part && part.invalid) {
                invalidCalls.add(part.toolCallId);
              }
            } else if (
              part.type === "tool-error" &&
              invalidCalls.has(part.toolCallId)
            ) {
              // Input that did not match the tool's schema: the SDK sends
              // the error back to the model, which can retry.
            } else if (part.type === "error" || part.type === "tool-error") {
              throw part.error;
            } else if (part.type === "finish-step") {
              modelSteps += 1;
              betweenSteps = true;
              if (
                part.finishReason !== "stop" &&
                part.finishReason !== "tool-calls"
              ) {
                throw new LocalinkTextStreamFinishError(part.finishReason);
              }
            } else if (part.type === "finish") {
              if (part.finishReason !== "stop") {
                throw new LocalinkTextStreamFinishError(part.finishReason);
              }
              // Ops proposed without finalize_bundle are still offered
              // (Ruling A21), with the fallback summary.
              const bundle = generation.builder.build();
              if (bundle) assertStageable(bundle);
              const assistantText = content.trim();
              if (!assistantText && !bundle) {
                throw new LocalinkTextStreamFinishError();
              }
              finishStudioStage<StagedStudioChatTurn>(binding, attemptId, {
                assistantText,
                steps,
                bundle,
                proposedAt,
              });
              terminated = true;
              if (!assistantText && bundle) {
                send({ type: "delta", text: bundle.summary });
              }
              if (bundle) {
                send({
                  type: "bundle",
                  opCount: bundle.operations.length,
                  summary: bundle.summary,
                });
              }
              log.end("complete", undefined, details());
              send({ type: "complete" });
              return;
            }
          }
          throw new LocalinkTextStreamFinishError();
        } catch (error) {
          if (canceled) return;
          if (abortController.signal.aborted) {
            abort();
            send({ type: "aborted" });
            return;
          }
          failStudioStage(binding, attemptId);
          const routeError = toStudioRouteError(error);
          terminated = true;
          log.error(error, routeError);
          log.end("error", routeError.code, details());
          send({
            type: "error",
            code: routeError.code,
            message: routeError.message,
            finishReason:
              error instanceof LocalinkTextStreamFinishError
                ? error.finishReason
                : undefined,
          });
          abortController.abort();
        } finally {
          progress.send = null;
          cleanup();
          if (!canceled) controller.close();
        }
      },
      cancel() {
        canceled = true;
        abort();
        cleanup();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": LOCALINK_TEXT_STREAM_CONTENT_TYPE,
      },
    },
  );
}
