import { getStoryProsePromptSnapshot } from "@/lib/server/story-prose-prompt-snapshots";

export const runtime = "nodejs";

type PromptSnapshotRouteContext = {
  params: Promise<{
    snapshotId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: PromptSnapshotRouteContext,
): Promise<Response> {
  const { snapshotId } = await context.params;
  const snapshot = getStoryProsePromptSnapshot(snapshotId);

  if (!snapshot) {
    return Response.json(
      {
        code: "PROMPT_SNAPSHOT_NOT_FOUND",
        message: "The prompts for this draft are no longer available.",
      },
      { status: 404 },
    );
  }

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
