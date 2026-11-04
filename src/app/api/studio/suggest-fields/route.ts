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
import { refreshStudioEntryFields } from "@/lib/server/studio/suggest-fields";
import { DEFAULT_STORY_GENERATION_MODEL } from "@/lib/story-generation-models";
import {
  type StagedStudioRefreshedFields,
  type StudioRefreshFieldsPreview,
  studioRefreshFieldsRequestSchema,
} from "@/lib/studio/suggest-fields-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-refresh-fields";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioRefreshFieldsRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The refresh request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;
    ids.entryId = input.entryId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const entry = workspace.entries.find((item) => item.id === input.entryId);
    if (!entry) throw new StudioNotFoundError();

    log.start({ model: DEFAULT_STORY_GENERATION_MODEL });
    const generationId = generateId("studio-refresh");
    binding = {
      storyId: input.storyId,
      kind: "plan",
      targetId: input.entryId,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const ops = await refreshStudioEntryFields(
      workspace,
      input.entryId,
      request.signal,
    );
    const staged: StagedStudioRefreshedFields = {
      ops,
      sourceRevision: entry.revision,
    };
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioRefreshFieldsPreview = { generationId };
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
