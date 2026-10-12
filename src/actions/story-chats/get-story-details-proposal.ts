"use server";

import { runLoggedAction } from "@/lib/action";
import { getStoryDetailsProposal as getProposal } from "@/lib/server/story-detail-proposals";

import { getStoryDetailsProposalReadSchema } from "./_schemas";

export async function getStoryDetailsProposal(input: unknown) {
  return runLoggedAction({ action: "get-story-details-proposal" }, async () => {
    const parsed = getStoryDetailsProposalReadSchema.parse(input);
    return getProposal(parsed.storyId, parsed.proposalId);
  });
}
