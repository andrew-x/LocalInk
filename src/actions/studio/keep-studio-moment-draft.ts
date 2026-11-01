"use server";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { keepMomentDraft } from "@/lib/server/studio/repository-prose";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";

import { keepStudioMomentDraftActionSchema } from "./_schemas";
import type { StudioProseDto } from "./_types";

export const keepStudioMomentDraft = publicActionClient
  .metadata({ action: "studio-keep-moment-draft" })
  .inputSchema(keepStudioMomentDraftActionSchema)
  .action(async ({ parsedInput }): Promise<StudioProseDto> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "moment-prose",
      targetId: parsedInput.momentId,
      generationId: parsedInput.generationId,
    };
    const { markdown } = getStudioStage<{ markdown: string }>(binding);
    if (!markdown.trim()) {
      throw new ActionError(
        "BAD_REQUEST",
        "The generated draft is empty. Generate it again.",
      );
    }
    const prose = getDb().transaction((tx) =>
      keepMomentDraft(tx, {
        storyId: parsedInput.storyId,
        momentId: parsedInput.momentId,
        markdown,
        expectedRevision: parsedInput.expectedRevision,
      }),
    );
    // Dropped only after a successful commit so a failed Keep can be retried.
    dropStudioStage(binding);
    return prose;
  });
