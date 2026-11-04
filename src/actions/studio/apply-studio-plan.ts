"use server";

import { publicActionClient } from "@/lib/action";
import { commitStudioPlan } from "@/lib/server/studio/plan-apply";

import { applyStudioPlanActionSchema } from "./_schemas";
import type { StudioWorkspace } from "./_types";

export const applyStudioPlan = publicActionClient
  .metadata({ action: "studio-apply-plan" })
  .inputSchema(applyStudioPlanActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioWorkspace> =>
      commitStudioPlan(parsedInput),
  );
