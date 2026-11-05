import { LOCALINK_AI_MODEL_PROFILES, streamLocalinkText } from "@/lib/ai";
import { toLocalinkTextStreamResponse } from "@/lib/server/ai-text-stream-response";
import { getSystemInstructions } from "@/lib/server/app-settings";
import {
  buildStudioMomentPrompt,
  getStudioMomentTemperature,
} from "@/lib/server/studio/moment-context";
import {
  StudioBadRequestError,
  StudioDraftExpiredError,
  StudioNotFoundError,
} from "@/lib/server/studio/prompt-kit";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";
import {
  createStudioRouteLog,
  type StudioRouteError,
  stageOnStop,
  studioErrorResponse,
  toStudioRouteError,
} from "@/lib/server/studio/route-kit";
import {
  beginStudioStage,
  failStudioStage,
  finishStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { STUDIO_PROSE_MODEL } from "@/lib/studio/models";
import {
  STUDIO_MOMENT_GENERATION_ID_HEADER,
  studioMomentProseRequestSchema,
} from "@/lib/studio/moment-contract";
import { getOrderedMoments } from "@/lib/studio/plan-order";

export const runtime = "nodejs";

const ACTION_NAME = "studio-moment-prose-generate";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioMomentProseRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The prose request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;
    ids.momentId = input.momentId;
    ids.generationId = input.generationId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const profile = LOCALINK_AI_MODEL_PROFILES[STUDIO_PROSE_MODEL];
    log.start({
      model: profile.model,
      attempt: input.attempt,
      precedingDrafts: input.precedingDrafts.length,
      hasNote: Boolean(input.note),
    });

    // Earlier beats of this scene that are staged but not kept. Only ids come
    // from the browser; their text is read from staging.
    const moment = workspace.planItems.find(
      (item) => item.id === input.momentId,
    );
    if (moment?.kind !== "moment") throw new StudioNotFoundError();
    const beatOrder = new Map(
      getOrderedMoments(workspace.planItems).map((item, position) => [
        item.id,
        position,
      ]),
    );
    const planById = new Map(
      workspace.planItems.map((item) => [item.id, item]),
    );
    const overlay = new Map<string, string>();
    for (const draft of input.precedingDrafts) {
      const earlier = planById.get(draft.momentId);
      if (
        earlier?.kind !== "moment" ||
        earlier.parentId !== moment.parentId ||
        (beatOrder.get(draft.momentId) ?? Number.POSITIVE_INFINITY) >=
          (beatOrder.get(input.momentId) ?? 0) ||
        overlay.has(draft.momentId)
      ) {
        throw new StudioBadRequestError("The prose request is invalid.");
      }
      try {
        const { markdown } = getStudioStage<{ markdown: string }>({
          storyId: input.storyId,
          kind: "moment-prose",
          targetId: draft.momentId,
          generationId: draft.generationId,
        });
        if (!markdown.trim()) throw new StudioDraftExpiredError();
        overlay.set(draft.momentId, markdown);
      } catch {
        throw new StudioDraftExpiredError();
      }
    }

    const globalInstructions = await getSystemInstructions();
    const { system, prompt, maxOutputTokens } = buildStudioMomentPrompt(
      workspace,
      input.momentId,
      globalInstructions,
      profile,
      input.attempt,
      overlay.size > 0 ? overlay : undefined,
      input.note || null,
    );

    const stageBinding: StudioStageBinding = {
      storyId: input.storyId,
      kind: "moment-prose",
      targetId: input.momentId,
      generationId: input.generationId,
    };
    const stageAttemptId = beginStudioStage(stageBinding);
    binding = stageBinding;
    attemptId = stageAttemptId;

    const failStage = () => failStudioStage(stageBinding, stageAttemptId);
    const stream = streamLocalinkText({
      model: profile.model,
      temperature: getStudioMomentTemperature(profile, input.attempt),
      system,
      prompt,
      maxOutputTokens,
      abortSignal: request.signal,
    });

    return toLocalinkTextStreamResponse({
      stream: {
        fullStream: stageOnStop(stream.fullStream, (text) =>
          finishStudioStage(stageBinding, stageAttemptId, {
            markdown: text.trim(),
          }),
        ),
      },
      requestSignal: request.signal,
      toRouteError: toStudioRouteError,
      onAbort: () => {
        failStage();
        log.end("aborted");
      },
      onComplete: () => {
        log.end("complete");
      },
      onError: (error, routeError) => {
        failStage();
        log.error(error, routeError);
        log.end("error", routeError.code);
      },
      headers: {
        [STUDIO_MOMENT_GENERATION_ID_HEADER]: input.generationId,
      },
    });
  } catch (error) {
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
