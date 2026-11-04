"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { keepStagedStudioVoiceSample } from "@/lib/server/studio/repository-voice";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import type { StudioStoryDto } from "@/lib/studio/contracts";
import type { StagedStudioVoiceSample } from "@/lib/studio/voice-contract";

import { keepStudioVoiceSampleActionSchema } from "./_schemas";

export const keepStudioVoiceSample = publicActionClient
  .metadata({ action: "studio-keep-voice-sample" })
  .inputSchema(keepStudioVoiceSampleActionSchema)
  .action(async ({ parsedInput }): Promise<StudioStoryDto> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "voice",
      targetId: `sample:${parsedInput.kind.toLowerCase()}`,
      generationId: parsedInput.generationId,
    };
    const staged = getStudioStage<StagedStudioVoiceSample>(binding);
    const story = getDb().transaction((tx) =>
      keepStagedStudioVoiceSample(tx, parsedInput.storyId, staged),
    );
    dropStudioStage(binding);
    return story;
  });
