"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { movePlanItem } from "@/lib/server/studio/repository-plan";

import { moveStudioPlanItemActionSchema } from "./_schemas";
import type { StudioPlanItemDto } from "./_types";

export const moveStudioPlanItem = publicActionClient
  .metadata({ action: "studio-move-plan-item" })
  .inputSchema(moveStudioPlanItemActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioPlanItemDto[]> =>
      getDb().transaction((tx) => movePlanItem(tx, parsedInput)),
  );
