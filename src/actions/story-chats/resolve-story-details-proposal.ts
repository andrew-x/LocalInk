"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { resolveStoryDetailsProposal as resolveProposal } from "@/lib/server/story-detail-proposals";

import { resolveStoryDetailsProposalSchema } from "./_schemas";

export const resolveStoryDetailsProposal = publicActionClient
  .metadata({ action: "resolve-story-details-proposal" })
  .inputSchema(resolveStoryDetailsProposalSchema)
  .action(async ({ parsedInput }) => {
    const result = await resolveProposal(parsedInput);
    revalidatePath("/");
    revalidatePath(`/story/${parsedInput.storyId}`);
    return result;
  });
