import { getSystemInstructions } from "@/lib/server/app-settings";
import { generateStudioCast } from "@/lib/server/studio/cast";
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
  type StudioCastPreview,
  studioCastRequestSchema,
} from "@/lib/studio/cast-contract";
import { STUDIO_ASSIST_MODEL } from "@/lib/studio/models";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-cast";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioCastRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The cast request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    if (workspace.story.setupStatus !== "draft") {
      throw new StudioBadRequestError(
        "This story is already planned. Add people and places from the Characters & places tab.",
      );
    }
    if (input.mode === "add") {
      const key = input.name.trim().toLowerCase();
      if (
        workspace.entries.some(
          (entry) =>
            entry.type === input.type &&
            entry.name.trim().toLowerCase() === key,
        )
      ) {
        throw new StudioBadRequestError(
          `${input.name} is already in the story.`,
        );
      }
    }

    log.start({ model: STUDIO_ASSIST_MODEL, mode: input.mode });
    const generationId = generateId("studio-cast");
    binding = {
      storyId: input.storyId,
      kind: "cast",
      targetId: input.mode,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    const globalInstructions = await getSystemInstructions();
    const staged = await generateStudioCast(
      input,
      workspace,
      globalInstructions,
      request.signal,
    );
    finishStudioStage(binding, attemptId, staged);

    const characters = staged.members.filter(
      (member) => member.type === "character",
    ).length;
    log.end("complete", undefined, {
      characters,
      places: staged.members.length - characters,
    });
    const preview: StudioCastPreview = {
      generationId,
      count: staged.members.length,
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
