"use server";

import { publicActionClient } from "@/lib/action";
import { resolveManuscriptProposal as resolveProposal } from "@/lib/server/story-chat-proposals";

import { resolveManuscriptProposalSchema } from "./_schemas";

export const resolveManuscriptProposal = publicActionClient
  .metadata({ action: "resolve-manuscript-proposal" })
  .inputSchema(resolveManuscriptProposalSchema)
  .action(async ({ parsedInput }) => resolveProposal(parsedInput));
