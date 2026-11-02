import type { StudioReadBackApplyResult } from "@/actions/studio/_types";
import { applyStudioReadBack } from "@/actions/studio/apply-studio-read-back";
import {
  postStudioJson,
  StudioRequestError,
} from "@/components/studio/studio-fetch";
import type { StudioReadBackPreview } from "@/lib/studio/read-back-contract";

export type StudioReadBackPatch = StudioReadBackApplyResult["workspacePatch"];

type SafeActionFailure = {
  serverError?: { message?: string };
  validationErrors?: { formErrors?: string[] };
};

/** A safe action's sanitized failure message, or `fallback`. */
export function actionFailureMessage(
  result: SafeActionFailure | undefined | null,
  fallback: string,
): string {
  return (
    result?.serverError?.message ??
    result?.validationErrors?.formErrors?.[0] ??
    fallback
  );
}

/**
 * Runs read-back for a moment and applies it. Resolves to the patch to merge,
 * or null when read-back was skipped or found the prose had moved on (the
 * apply action discards a stale result by source hash). Once the apply action
 * has been sent its result is always returned: the server already committed.
 * Shared by settle work, Keep, split, restore, and the scene menu's Re-read.
 */
export async function readBackStudioMoment({
  storyId,
  momentId,
  force,
  signal,
}: {
  storyId: string;
  momentId: string;
  force: boolean;
  signal?: AbortSignal;
}): Promise<StudioReadBackPatch | null> {
  const preview = await postStudioJson<StudioReadBackPreview>(
    "/api/studio/read-back",
    { storyId, momentId, force },
    signal,
  );
  if (preview.skipped || signal?.aborted) return null;
  const result = await applyStudioReadBack({
    storyId,
    momentId,
    generationId: preview.generationId,
  });
  if (!result?.data) {
    throw new StudioRequestError(
      actionFailureMessage(result, "The read-back could not be saved."),
    );
  }
  return result.data.applied ? result.data.workspacePatch : null;
}
