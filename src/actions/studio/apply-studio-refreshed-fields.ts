"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { applyRefreshedEntryFields } from "@/lib/server/studio/repository-bible";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import type { StagedStudioRefreshedFields } from "@/lib/studio/suggest-fields-contract";

import { applyStudioRefreshedFieldsActionSchema } from "./_schemas";
import type { StudioRefreshedFieldsApplyResult } from "./_types";

export const applyStudioRefreshedFields = publicActionClient
  .metadata({ action: "studio-apply-refreshed-fields" })
  .inputSchema(applyStudioRefreshedFieldsActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioRefreshedFieldsApplyResult> => {
      const binding: StudioStageBinding = {
        storyId: parsedInput.storyId,
        kind: "plan",
        targetId: parsedInput.entryId,
        generationId: parsedInput.generationId,
      };
      const staged = getStudioStage<StagedStudioRefreshedFields>(binding);
      const entry = getDb().transaction((tx) =>
        applyRefreshedEntryFields(tx, {
          storyId: parsedInput.storyId,
          entryId: parsedInput.entryId,
          sourceRevision: staged.sourceRevision,
          ops: staged.ops,
        }),
      );
      dropStudioStage(binding);
      return { entry, stale: entry === null };
    },
  );
