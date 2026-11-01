import { StudioNotFoundError } from "@/lib/server/studio/prompt-kit";
import { runStudioReadBack } from "@/lib/server/studio/read-back";
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
import { hashText, isMeaningfulChange } from "@/lib/studio/prose-text";
import {
  type StagedStudioReadBack,
  type StudioReadBackPreview,
  studioReadBackRequestSchema,
} from "@/lib/studio/read-back-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-read-back";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioReadBackRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The read-back request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;
    ids.momentId = input.momentId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const moment = workspace.planItems.find(
      (item) => item.id === input.momentId,
    );
    if (moment?.kind !== "moment") throw new StudioNotFoundError();

    const generationId = generateId("studio-readback");
    const skip = (): Response => {
      log.end("complete");
      const preview: StudioReadBackPreview = { generationId, skipped: true };
      return Response.json(preview);
    };

    const prose = workspace.prose.find(
      (item) => item.momentId === input.momentId,
    );
    if (!prose?.markdown.trim()) return skip();
    if (!input.force) {
      if (hashText(prose.markdown) === prose.readBackSourceHash) return skip();
      if (
        prose.readBackSourceHash !== "" &&
        !isMeaningfulChange(prose.readBackSentenceHashes, prose.markdown)
      ) {
        return skip();
      }
    }

    log.start({
      model: DEFAULT_STORY_GENERATION_MODEL,
      force: input.force,
    });
    binding = {
      storyId: input.storyId,
      kind: "read-back",
      targetId: input.momentId,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const result = await runStudioReadBack(
      workspace,
      input.momentId,
      request.signal,
    );
    const staged: StagedStudioReadBack = result;
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioReadBackPreview = { generationId, skipped: false };
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
