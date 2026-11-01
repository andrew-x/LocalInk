"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { removePlanSubtree } from "@/lib/server/studio/repository-plan";
import { putStudioUndo } from "@/lib/server/studio/staging";

import { deleteStudioPlanItemActionSchema } from "./_schemas";

export const deleteStudioPlanItem = publicActionClient
  .metadata({ action: "studio-delete-plan-item" })
  .inputSchema(deleteStudioPlanItemActionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{ deletedIds: string[]; undoToken: string }> => {
      let undoToken = "";
      // Staging happens inside the transaction so a failure rolls the delete back.
      const { deletedIds } = getDb().transaction((tx) =>
        removePlanSubtree(
          tx,
          parsedInput.storyId,
          parsedInput.itemId,
          (snapshot) => {
            undoToken = putStudioUndo(parsedInput.storyId, snapshot);
          },
        ),
      );
      return { deletedIds, undoToken };
    },
  );
