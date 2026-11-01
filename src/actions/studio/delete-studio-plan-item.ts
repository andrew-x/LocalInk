"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { removePlanSubtree } from "@/lib/server/studio/repository-plan";
import {
  beginStudioStage,
  finishStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";
import { generateId } from "@/lib/util";

import { deleteStudioPlanItemActionSchema } from "./_schemas";

export const deleteStudioPlanItem = publicActionClient
  .metadata({ action: "studio-delete-plan-item" })
  .inputSchema(deleteStudioPlanItemActionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{ deletedIds: string[]; undoToken: string }> => {
      const undoToken = generateId("studio-undo");
      // The restore action only knows the token, so it doubles as the target.
      const binding: StudioStageBinding = {
        storyId: parsedInput.storyId,
        kind: "undo-delete",
        targetId: undoToken,
        generationId: undoToken,
      };
      const { deletedIds } = getDb().transaction((tx) =>
        removePlanSubtree(
          tx,
          parsedInput.storyId,
          parsedInput.itemId,
          (snapshot) => {
            const attemptId = beginStudioStage(binding);
            finishStudioStage(binding, attemptId, snapshot);
          },
        ),
      );
      return { deletedIds, undoToken };
    },
  );
