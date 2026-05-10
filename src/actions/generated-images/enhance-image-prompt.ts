"use server";

import { publicActionClient } from "@/lib/action";
import { enhanceGeneratedImagePrompt } from "@/lib/server/generated-images";

import { enhanceImagePromptActionSchema } from "./_schemas";

export const enhanceImagePrompt = publicActionClient
  .metadata({ action: "enhance-image-prompt" })
  .inputSchema(enhanceImagePromptActionSchema)
  .action(async ({ parsedInput }): Promise<{ prompt: string }> => {
    return {
      prompt: await enhanceGeneratedImagePrompt(parsedInput),
    };
  });
