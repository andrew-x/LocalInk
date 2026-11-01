import { getSystemInstructions } from "@/lib/server/app-settings";
import { generateStudioPlan } from "@/lib/server/studio/planning";
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
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { DEFAULT_STORY_GENERATION_MODEL } from "@/lib/story-generation-models";
import {
  STUDIO_PLAN_STORY_TARGET,
  studioPlanRequestSchema,
  toStudioPlanPreview,
} from "@/lib/studio/planning-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-plan-generate";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioPlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The plan request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;

    const targetItemId =
      input.mode === "initial" ? undefined : input.targetItemId;
    ids.storyId = input.storyId;
    ids.targetItemId = targetItemId;
    log.start({
      mode: input.mode,
      model: DEFAULT_STORY_GENERATION_MODEL,
      answerCount: input.mode === "initial" ? input.answers.length : undefined,
    });

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    if (input.mode === "initial" && !workspace.story.brainDump.trim()) {
      throw new StudioBadRequestError("Add a brain dump before planning.");
    }
    const globalInstructions = await getSystemInstructions();

    const generationId = generateId("studio-plan");
    binding = {
      storyId: input.storyId,
      kind: "plan",
      targetId: targetItemId ?? STUDIO_PLAN_STORY_TARGET,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const staged = await generateStudioPlan(
      input,
      workspace,
      globalInstructions,
      request.signal,
    );
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    return Response.json(toStudioPlanPreview(staged, generationId));
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
