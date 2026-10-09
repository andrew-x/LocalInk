"use server";

import { runLoggedAction } from "@/lib/action";
import { getManuscriptProposal as getProposal } from "@/lib/server/story-chat-proposals";

import { getManuscriptProposalReadSchema } from "./_schemas";

export async function getManuscriptProposal(input: unknown) {
  return runLoggedAction({ action: "get-manuscript-proposal" }, async () => {
    const parsed = getManuscriptProposalReadSchema.parse(input);
    return getProposal(parsed.storyId, parsed.proposalId);
  });
}
