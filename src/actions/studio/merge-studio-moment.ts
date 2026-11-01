"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { mergeMomentIntoPrevious } from "@/lib/server/studio/repository-prose";

import { mergeStudioMomentActionSchema } from "./_schemas";
import type {
  StudioChangeDto,
  StudioPlanItemDto,
  StudioProseDto,
} from "./_types";

export const mergeStudioMoment = publicActionClient
  .metadata({ action: "studio-merge-moment" })
  .inputSchema(mergeStudioMomentActionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{
      prose: StudioProseDto[];
      planItems: StudioPlanItemDto[];
      changes: StudioChangeDto[];
      deletedIds: string[];
    }> => getDb().transaction((tx) => mergeMomentIntoPrevious(tx, parsedInput)),
  );
