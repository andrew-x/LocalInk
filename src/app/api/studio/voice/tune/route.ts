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
import {
  beginStudioStage,
  failStudioStage,
  finishStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { interpretStudioVoiceComplaint } from "@/lib/server/studio/voice-changes";
import { applyStudioVoiceOps } from "@/lib/studio/voice";
import {
  type StagedStudioVoiceChanges,
  type StudioVoiceTunePreview,
  studioVoiceTuneRequestSchema,
} from "@/lib/studio/voice-contract";
import { generateId } from "@/lib/util";

export const runtime = "nodejs";

const ACTION_NAME = "studio-voice-tune";
const TUNE_INSTRUCTION =
  "Rewrite this passage so it fits the voice. Keep what happens. This is a one-off request for this passage only. The writer said:";

export async function POST(request: Request): Promise<Response> {
  const ids: Record<string, string | undefined> = {};
  const log = createStudioRouteLog(ACTION_NAME, ids);
  let binding: StudioStageBinding | undefined;
  let attemptId: string | undefined;

  try {
    const body: unknown = await request.json().catch(() => null);
    const parsed = studioVoiceTuneRequestSchema.safeParse(body);
    if (!parsed.success) {
      const badRequest: StudioRouteError = {
        code: "BAD_REQUEST",
        message: "The voice tuning request is invalid.",
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
    const { story } = workspace;

    log.start({
      model: story.proseModel,
      selectionChars: input.selectedText.length,
    });
    const generationId = generateId("studio-voice-tune");
    binding = {
      storyId: input.storyId,
      kind: "voice",
      // The apply action builds the same binding from the bare moment id.
      targetId: `tune:${input.momentId}`,
      generationId,
    };
    attemptId = beginStudioStage(binding);

    // The passage is the author's own text, so it is the sample. No ops is
    // fine here: the passage is still rewritten under the current voice.
    const ops = await interpretStudioVoiceComplaint(
      { story, sampleText: input.selectedText, complaint: input.complaint },
      request.signal,
    );
    const proposed = applyStudioVoiceOps(
      { genre: story.genre, voice: story.voice, samples: [] },
      ops,
      generateId,
    );

    const globalInstructions = await getSystemInstructions();
    const { options } = await generateStudioRewrite(
      workspace,
      {
        storyId: input.storyId,
        momentId: input.momentId,
        selectedText: input.selectedText,
        mode: "custom",
        instruction: `${TUNE_INSTRUCTION} ${input.complaint.trim()}`,
      },
      request.signal,
      globalInstructions,
      { genre: proposed.genre, voice: proposed.voice },
      story.proseModel,
    );
    const [rewrite] = options;

    const staged: StagedStudioVoiceChanges = { ops };
    finishStudioStage(binding, attemptId, staged);

    log.end("complete");
    const preview: StudioVoiceTunePreview = { generationId, rewrite, ops };
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
