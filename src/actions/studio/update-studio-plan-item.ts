"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { patchPlanItem } from "@/lib/server/studio/repository-plan";

import { updateStudioPlanItemActionSchema } from "./_schemas";
import type { StudioPlanItemDto } from "./_types";

export const updateStudioPlanItem = publicActionClient
  .metadata({ action: "studio-update-plan-item" })
  .inputSchema(updateStudioPlanItemActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioPlanItemDto> =>
      getDb().transaction((tx) => patchPlanItem(tx, parsedInput)),
  );
