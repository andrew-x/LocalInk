import { ActionError } from "@/lib/action-error";
import {
  StudioBadRequestError,
  StudioNotFoundError,
} from "@/lib/server/studio/prompt-kit";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";
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
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { interpretStudioVoiceComplaint } from "@/lib/server/studio/voice-changes";
import {
  type StagedStudioVoiceChanges,
  type StagedStudioVoiceSample,
  type StudioVoiceChangesPreview,
  studioVoiceFeedbackRequestSchema,
} from "@/lib/studio/voice-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-voice-feedback";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioVoiceFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The voice feedback is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const { story } = workspace;
    const kindKey = input.kind.toLowerCase();

    // The sample text is read from the stage or the kept sample, never from
    // the browser. Reading the stage does not drop it.
    let sampleText: string;
    if ("generationId" in input.sample) {
      ids.sampleGenerationId = input.sample.generationId;
      try {
        sampleText = getStudioStage<StagedStudioVoiceSample>({
          storyId: input.storyId,
          kind: "voice",
          targetId: `sample:${kindKey}`,
          generationId: input.sample.generationId,
        }).text;
      } catch (error) {
        if (error instanceof ActionError) {
          const expired: StudioRouteError = {
            code: "DRAFT_EXPIRED",
            message:
              "This sample is no longer available. Use ↻ to write it again.",
            status: 409,
          };
          log.end("error", expired.code);
          return studioErrorResponse(expired);
        }
        throw error;
      }
    } else {
      const { sampleId } = input.sample;
      ids.sampleId = sampleId;
      const kept = story.voiceSamples.find((sample) => sample.id === sampleId);
      if (!kept) throw new StudioNotFoundError();
      sampleText = kept.text;
    }

    log.start({ model: story.chatModel });
    const generationId = generateId("studio-voice-feedback");
    binding = {
      storyId: input.storyId,
      kind: "voice",
      targetId: `feedback:${kindKey}`,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const ops = await interpretStudioVoiceComplaint(
      { story, sampleText, complaint: input.complaint },
      request.signal,
    );
    if (ops.length === 0) {
      throw new StudioBadRequestError(
        "Couldn't turn that note into a change. Try saying it another way.",
      );
    }
    const staged: StagedStudioVoiceChanges = { ops };
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioVoiceChangesPreview = { generationId, ops };
    return Response.json(preview);
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
