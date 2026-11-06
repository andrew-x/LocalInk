"use server";

import { publicActionClient } from "@/lib/action";
import { commitStudioCastRevision } from "@/lib/server/studio/cast-apply";

import { applyStudioCastRevisionActionSchema } from "./_schemas";
import type { StudioCastRevisionApplyResult } from "./_types";

export const applyStudioCastRevision = publicActionClient
  .metadata({ action: "studio-apply-cast-revision" })
  .inputSchema(applyStudioCastRevisionActionSchema)
  .action(
    async ({ parsedInput }): Promise<StudioCastRevisionApplyResult> =>
      commitStudioCastRevision(parsedInput),
  );
