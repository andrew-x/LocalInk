import { getSystemInstructions } from "@/lib/server/app-settings";
import { generateStudioQuestions } from "@/lib/server/studio/planning";
import { StudioNotFoundError } from "@/lib/server/studio/prompt-kit";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";
import {
  createStudioRouteLog,
  type StudioRouteError,
  studioErrorResponse,
  toStudioRouteError,
} from "@/lib/server/studio/route-kit";
import { DEFAULT_STORY_GENERATION_MODEL } from "@/lib/story-generation-models";
import { studioQuestionsRequestSchema } from "@/lib/studio/planning-contract";

export const runtime = "nodejs";

const ACTION_NAME = "studio-questions";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioQuestionsRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The questions request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }

    ids.storyId = parsed.data.storyId;
    log.start({ model: DEFAULT_STORY_GENERATION_MODEL });

    const workspace = loadStudioWorkspace(parsed.data.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const globalInstructions = await getSystemInstructions();
    const result = await generateStudioQuestions(
      workspace,
      globalInstructions,
      request.signal,
    );

    log.end("complete");
    return Response.json(result);
  } catch (error) {
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
