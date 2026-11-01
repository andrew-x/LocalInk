"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { createPlanItem } from "@/lib/server/studio/repository-plan";

import { createStudioPlanItemActionSchema } from "./_schemas";
import type { StudioPlanItemDto } from "./_types";

export const createStudioPlanItem = publicActionClient
  .metadata({ action: "studio-create-plan-item" })
  .inputSchema(createStudioPlanItemActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioPlanItemDto> =>
      getDb().transaction((tx) => createPlanItem(tx, parsedInput)),
  );
