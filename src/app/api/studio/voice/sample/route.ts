import { getSystemInstructions } from "@/lib/server/app-settings";
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
import { generateStudioVoiceSample } from "@/lib/server/studio/voice-sample";
import { STUDIO_PROSE_MODEL } from "@/lib/studio/models";
import {
  type StudioVoiceSamplePreview,
  studioVoiceSampleRequestSchema,
} from "@/lib/studio/voice-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-voice-sample";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioVoiceSampleRequestSchema.safeParse(body);
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
    if (input.planItemId) ids.planItemId = input.planItemId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();

    log.start({ model: STUDIO_PROSE_MODEL });
    const generationId = generateId("studio-voice-sample");
    binding = {
      storyId: input.storyId,
      kind: "voice",
      targetId: `sample:${input.kind.toLowerCase()}`,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const staged = await generateStudioVoiceSample(
      workspace,
      { kind: input.kind, planItemId: input.planItemId },
      request.signal,
      await getSystemInstructions(),
    );
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioVoiceSamplePreview = {
      generationId,
      text: staged.text,
      planItemId: staged.planItemId,
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
