"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { createLogger } from "@/lib/logger";
import { indexChapterContent } from "@/lib/server/chapter-indexing";

import { indexChapterActionSchema } from "./_schemas";
import type { ChapterIndexResult } from "./_types";

const indexChapterLogger = createLogger("index-chapter");

export const indexChapter = publicActionClient
  .metadata({ action: "index-chapter" })
  .inputSchema(indexChapterActionSchema)
  .action(async ({ parsedInput }): Promise<ChapterIndexResult> => {
    try {
      const result = await indexChapterContent(parsedInput);

      if (result.status === "cleared-empty" || result.status === "indexed") {
        revalidatePath("/");
        revalidatePath(`/story/${parsedInput.storyId}`);
      }

      return result;
    } catch (error) {
      indexChapterLogger.error("failed", {
        storyId: parsedInput.storyId,
        chapterId: parsedInput.chapterId,
        triggerReason: parsedInput.triggerReason,
        errorName: getErrorName(error),
      });

      throw new ActionError(
        "INTERNAL_ERROR",
        "The chapter could not be indexed.",
      );
    }
  });

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
