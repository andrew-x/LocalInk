"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { applyStagedStudioVoiceChanges } from "@/lib/server/studio/repository-voice";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import type {
  StagedStudioVoiceChanges,
  StudioVoiceChangesApplyResult,
} from "@/lib/studio/voice-contract";

import { applyStudioVoiceChangesActionSchema } from "./_schemas";

export const applyStudioVoiceChanges = publicActionClient
  .metadata({ action: "studio-apply-voice-changes" })
  .inputSchema(applyStudioVoiceChangesActionSchema)
  .action(async ({ parsedInput }): Promise<StudioVoiceChangesApplyResult> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "voice",
      targetId:
        parsedInput.source === "feedback"
          ? `feedback:${parsedInput.targetId.toLowerCase()}`
          : `tune:${parsedInput.targetId}`,
      generationId: parsedInput.generationId,
    };
    const staged = getStudioStage<StagedStudioVoiceChanges>(binding);
    const result = getDb().transaction((tx) =>
      applyStagedStudioVoiceChanges(tx, parsedInput.storyId, staged.ops),
    );
    dropStudioStage(binding);
    return result;
  });
