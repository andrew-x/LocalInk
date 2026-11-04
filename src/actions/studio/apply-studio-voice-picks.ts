"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { applyStagedStudioVoicePicks } from "@/lib/server/studio/repository-voice";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import type { StudioStoryDto } from "@/lib/studio/contracts";
import type { StagedStudioVoicePicks } from "@/lib/studio/voice-contract";

import { applyStudioVoicePicksActionSchema } from "./_schemas";

export const applyStudioVoicePicks = publicActionClient
  .metadata({ action: "studio-apply-voice-picks" })
  .inputSchema(applyStudioVoicePicksActionSchema)
  .action(async ({ parsedInput }): Promise<StudioStoryDto> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "voice",
      targetId: "picks",
      generationId: parsedInput.generationId,
    };
    const staged = getStudioStage<StagedStudioVoicePicks>(binding);
    const story = getDb().transaction((tx) =>
      applyStagedStudioVoicePicks(tx, parsedInput.storyId, staged),
    );
    dropStudioStage(binding);
    return story;
  });
