import { reviseStudioCastEntry } from "@/lib/server/studio/cast";
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
import {
  type StudioCastRevisePreview,
  studioCastReviseRequestSchema,
} from "@/lib/studio/cast-contract";
import { STUDIO_ASSIST_MODEL } from "@/lib/studio/models";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-cast-revise";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioCastReviseRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The revision request is invalid.",
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
    if (entry.type !== "character" && entry.type !== "place") {
      throw new StudioBadRequestError(
        "Only characters and places can be shaped this way.",
      );
    }

    log.start({ model: STUDIO_ASSIST_MODEL, kind: input.instruction.kind });
    const generationId = generateId("studio-cast-revise");
    binding = {
      storyId: input.storyId,
      kind: "cast",
      targetId: `revise:${input.entryId}`,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const staged = await reviseStudioCastEntry(
      workspace,
      input.entryId,
      input.instruction,
      request.signal,
    );
    finishStudioStage(binding, attemptId, staged);

    log.end("complete", undefined, {
      ops: staged.ops.length,
      summaryChanged: staged.summary !== null,
    });
    const preview: StudioCastRevisePreview = { generationId };
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
