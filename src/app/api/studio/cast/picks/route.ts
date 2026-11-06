import { generateStudioCastPicks } from "@/lib/server/studio/cast";
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
  type StudioCastPicksResponse,
  studioCastPicksRequestSchema,
} from "@/lib/studio/cast-contract";
import { STUDIO_ASSIST_MODEL } from "@/lib/studio/models";

export const runtime = "nodejs";

const ACTION_NAME = "studio-cast-picks";

/** Questions only: shown to the author, never persisted, so nothing is staged. */
export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioCastPicksRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The questions request is invalid.",
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

    log.start({ model: STUDIO_ASSIST_MODEL });
    const picks = await generateStudioCastPicks(
      workspace,
      input.entryId,
      input.asked,
      request.signal,
    );
    log.end("complete", undefined, { picks: picks.length });
    const response: StudioCastPicksResponse = { picks };
    return Response.json(response);
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
