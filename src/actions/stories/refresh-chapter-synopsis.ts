"use server";

import { publicActionClient } from "@/lib/action";
import { refreshStoryChapterSynopsis } from "@/lib/server/story-chapter-synopses";

import { refreshChapterSynopsisActionSchema } from "./_schemas";

/** Refresh in the background after saving; generation reads validated caches. */
export const refreshChapterSynopsis = publicActionClient
  .metadata({ action: "refresh-chapter-synopsis" })
  .inputSchema(refreshChapterSynopsisActionSchema)
  .action(async ({ parsedInput }): Promise<{ didRefresh: boolean }> => {
    return refreshStoryChapterSynopsis(parsedInput);
  });
