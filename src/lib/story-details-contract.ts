import { z } from "zod";

import { updateStoryActionSchema } from "@/actions/stories/_schemas";
import type {
  StoryCharacter,
  StoryLocation,
  StoryVoiceExemplar,
} from "@/lib/drizzle/schema";
import type {
  ManuscriptProposalDecision,
  ManuscriptProposalStatus,
} from "@/lib/story-manuscript-contract";

export type StoryDetailsSnapshot = {
  name: string;
  description: string;
  backstory: string;
  style: string;
  systemInstructions: string;
  characters: StoryCharacter[];
  locations: StoryLocation[];
  voiceExemplars: StoryVoiceExemplar[];
};

const fields = updateStoryActionSchema.required().shape;

export const storyDetailsEditSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  changes: z
    .array(
      z.discriminatedUnion("field", [
        z.object({ field: z.literal("name"), after: fields.name }),
        z.object({
          field: z.literal("description"),
          after: fields.description,
        }),
        z.object({ field: z.literal("backstory"), after: fields.backstory }),
        z.object({ field: z.literal("style"), after: fields.style }),
        z.object({
          field: z.literal("systemInstructions"),
          after: fields.systemInstructions,
        }),
        z.object({ field: z.literal("characters"), after: fields.characters }),
        z.object({ field: z.literal("locations"), after: fields.locations }),
        z.object({
          field: z.literal("voiceExemplars"),
          after: fields.voiceExemplars,
        }),
      ]),
    )
    .min(1)
    .max(8),
});

export type StoryDetailsEditInput = z.infer<typeof storyDetailsEditSchema>;
export type StoryDetailsChange = {
  [Field in keyof StoryDetailsSnapshot]: {
    field: Field;
    before: StoryDetailsSnapshot[Field];
    after: StoryDetailsSnapshot[Field];
  };
}[keyof StoryDetailsSnapshot];

export type StoryDetailsProposalCandidate = {
  summary: string;
  changes: StoryDetailsChange[];
};
export type StoryDetailsProposalStatus = ManuscriptProposalStatus;
export type StoryDetailsProposalDecision = ManuscriptProposalDecision;
export type StoryDetailsProposal = StoryDetailsProposalCandidate & {
  id: string;
  storyId: string;
  chatId: string;
  messageId: string;
  generationId: string;
  status: StoryDetailsProposalStatus;
  createdAt: string;
  updatedAt: string;
};
export type ResolveStoryDetailsProposalInput = {
  storyId: string;
  proposalId: string;
  decision: StoryDetailsProposalDecision;
};
