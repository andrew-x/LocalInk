"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { patchStudioVoice } from "@/lib/server/studio/repository-voice";

import { updateStudioVoiceActionSchema } from "./_schemas";
import type { StudioStoryDto } from "./_types";

export const updateStudioVoice = publicActionClient
  .metadata({ action: "studio-update-voice" })
  .inputSchema(updateStudioVoiceActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioStoryDto> =>
      getDb().transaction((tx) =>
        patchStudioVoice(tx, parsedInput.storyId, parsedInput.ops),
      ),
  );
