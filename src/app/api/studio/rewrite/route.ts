import { getSystemInstructions } from "@/lib/server/app-settings";
import { StudioNotFoundError } from "@/lib/server/studio/prompt-kit";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";
import { generateStudioRewrite } from "@/lib/server/studio/rewrite";
import {
  createStudioRouteLog,
  type StudioRouteError,
  studioErrorResponse,
  toStudioRouteError,
} from "@/lib/server/studio/route-kit";
import { STUDIO_PROSE_MODEL } from "@/lib/studio/models";
import { studioRewriteRequestSchema } from "@/lib/studio/rewrite-contract";

export const runtime = "nodejs";

const ACTION_NAME = "studio-rewrite";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioRewriteRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The rewrite request is invalid.",
        status: 400,
      };
      log.end("error", badRequest.code);
      return studioErrorResponse(badRequest);
    }
    const input = parsed.data;
    ids.storyId = input.storyId;
    ids.momentId = input.momentId;
    log.start({
      mode: input.mode,
      model: STUDIO_PROSE_MODEL,
      selectionChars: input.selectedText.length,
    });

    const workspace = loadStudioWorkspace(input.storyId);
    if (!workspace) throw new StudioNotFoundError();
    const globalInstructions = await getSystemInstructions();

    const response = await generateStudioRewrite(
      workspace,
      input,
      request.signal,
      globalInstructions,
    );
    log.end("complete");
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
