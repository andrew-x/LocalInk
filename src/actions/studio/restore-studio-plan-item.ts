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
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";

import { restoreStudioPlanItemActionSchema } from "./_schemas";
import type { StudioWorkspace } from "./_types";

export const restoreStudioPlanItem = publicActionClient
  .metadata({ action: "studio-restore-plan-item" })
  .inputSchema(restoreStudioPlanItemActionSchema)
  .action(async ({ parsedInput }): Promise<StudioWorkspace> => {
    const binding: StudioStageBinding = {
      storyId: parsedInput.storyId,
      kind: "undo-delete",
      targetId: parsedInput.undoToken,
      generationId: parsedInput.undoToken,
    };
    const snapshot = getStudioStage<StudioDeletedSubtree>(binding);
    getDb().transaction((tx) =>
      restorePlanSubtree(tx, snapshot, day().toISOString()),
    );
    dropStudioStage(binding);
    const workspace = loadStudioWorkspace(parsedInput.storyId);
    if (!workspace) {
      throw new ActionError("BAD_REQUEST", "The story could not be found.");
    }
    return workspace;
  });
