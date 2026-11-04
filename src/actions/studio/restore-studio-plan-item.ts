"use server";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import {
  loadStudioWorkspace,
  restorePlanSubtree,
  type StudioDeletedSubtree,
} from "@/lib/server/studio/repository";
import { dropStudioUndo, getStudioUndo } from "@/lib/server/studio/staging";

import { restoreStudioPlanItemActionSchema } from "./_schemas";
import type { StudioWorkspace } from "./_types";

export const restoreStudioPlanItem = publicActionClient
  .metadata({ action: "studio-restore-plan-item" })
  .inputSchema(restoreStudioPlanItemActionSchema)
  .action(async ({ parsedInput }): Promise<StudioWorkspace> => {
    const snapshot = getStudioUndo<StudioDeletedSubtree>(
      parsedInput.storyId,
      parsedInput.undoToken,
    );
    getDb().transaction((tx) =>
      restorePlanSubtree(tx, snapshot, day().toISOString()),
    );
    dropStudioUndo(parsedInput.storyId, parsedInput.undoToken);
    const workspace = loadStudioWorkspace(parsedInput.storyId);
    if (!workspace) {
      throw new ActionError("BAD_REQUEST", "The story could not be found.");
    }
    return workspace;
  });
