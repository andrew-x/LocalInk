"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { applySuggestedEntryFields } from "@/lib/server/studio/repository-bible";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { normalizeFieldLabel } from "@/lib/studio/entry-fields";
import type { StagedStudioSuggestedFields } from "@/lib/studio/suggest-fields-contract";

import { applyStudioSuggestedFieldsActionSchema } from "./_schemas";
import type { StudioSuggestedFieldsApplyResult } from "./_types";

export const applyStudioSuggestedFields = publicActionClient
  .metadata({ action: "studio-apply-suggested-fields" })
  .inputSchema(applyStudioSuggestedFieldsActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioSuggestedFieldsApplyResult> => {
      const binding: StudioStageBinding = {
        storyId: parsedInput.storyId,
        kind: "plan",
        targetId: parsedInput.entryId,
        generationId: parsedInput.generationId,
      };
      const staged = getStudioStage<StagedStudioSuggestedFields>(binding);
      const picked = new Set(parsedInput.pickedLabels.map(normalizeFieldLabel));
      const { entry, skipped } = getDb().transaction((tx) =>
        applySuggestedEntryFields(tx, {
          storyId: parsedInput.storyId,
          entryId: parsedInput.entryId,
          expectedRevision: parsedInput.expectedRevision,
          proposed: staged.suggestions.filter((suggestion) =>
            picked.has(normalizeFieldLabel(suggestion.label)),
          ),
        }),
      );
      dropStudioStage(binding);
      return { entry, skippedForCap: skipped };
    },
  );
