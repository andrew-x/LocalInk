"use server";

import { publicActionClient } from "@/lib/action";
import { getDb } from "@/lib/drizzle/db";
import { splitMoment } from "@/lib/server/studio/repository-prose";

import { splitStudioMomentActionSchema } from "./_schemas";
import type { StudioPlanItemDto, StudioProseDto } from "./_types";

export const splitStudioMoment = publicActionClient
  .metadata({ action: "studio-split-moment" })
  .inputSchema(splitStudioMomentActionSchema)
  .action(
    async ({
      parsedInput,
    }): Promise<{ prose: StudioProseDto[]; planItems: StudioPlanItemDto[] }> =>
      getDb().transaction((tx) => splitMoment(tx, parsedInput)),
  );
