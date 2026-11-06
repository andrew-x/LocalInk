"use server";

import { publicActionClient } from "@/lib/action";
import { commitStudioCast } from "@/lib/server/studio/cast-apply";

import { applyStudioCastActionSchema } from "./_schemas";
import type { StudioCastApplyResult } from "./_types";

export const applyStudioCast = publicActionClient
  .metadata({ action: "studio-apply-cast" })
  .inputSchema(applyStudioCastActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioCastApplyResult> =>
      commitStudioCast(parsedInput),
  );
