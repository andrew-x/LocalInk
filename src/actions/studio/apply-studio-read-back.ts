"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { applyStagedReadBack } from "@/lib/server/studio/read-back-apply";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import type { StagedStudioReadBack } from "@/lib/studio/read-back-contract";

import { applyStudioReadBackActionSchema } from "./_schemas";
import type { StudioReadBackApplyResult } from "./_types";

export const applyStudioReadBack = publicActionClient
  .metadata({ action: "studio-apply-read-back" })
  .inputSchema(applyStudioReadBackActionSchema)
  .action(async ({ parsedInput }): Promise<StudioReadBackApplyResult> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "read-back",
      targetId: parsedInput.momentId,
      generationId: parsedInput.generationId,
    };
    const staged = getStudioStage<StagedStudioReadBack>(binding);
    const result = getDb().transaction((tx) =>
      applyStagedReadBack(tx, {
        storyId: parsedInput.storyId,
        momentId: parsedInput.momentId,
        staged,
      }),
    );
    // A stale read-back is discarded too, so it can never be applied later.
    dropStudioStage(binding);
    return result;
  });
