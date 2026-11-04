import { StudioNotFoundError } from "@/lib/server/studio/prompt-kit";
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
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { generateStudioVoicePicks } from "@/lib/server/studio/voice-picks";
import {
  type StudioVoicePicksPreview,
  studioVoicePicksRequestSchema,
} from "@/lib/studio/voice-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-voice-picks";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioVoicePicksRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The voice request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();

    log.start({ model: workspace.story.chatModel, mode: input.mode });
    const generationId = generateId("studio-voice-picks");
    binding = {
      storyId: input.storyId,
      kind: "voice",
      targetId: "picks",
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const staged = await generateStudioVoicePicks(
      workspace,
      input.mode,
      request.signal,
    );
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioVoicePicksPreview = {
      generationId,
      picks: staged.picks,
      moments: staged.moments.map((moment) => ({
        kind: moment.kind,
        planItemId: moment.planItemId,
      })),
    };
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
