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
const collectionFields = updateStoryActionSchema.shape;

function entryEditsSchema<Shape extends z.ZodRawShape>(
  entry: z.ZodObject<Shape>,
) {
  return z
    .array(
      z.discriminatedUnion("operation", [
        z.object({ operation: z.literal("add"), after: entry }),
        z.object({
          operation: z.literal("update"),
          id: z.string().trim().min(1).max(128),
          after: entry,
        }),
        z.object({
          operation: z.literal("remove"),
          id: z.string().trim().min(1).max(128),
        }),
      ]),
    )
    .min(1)
    .max(200);
}

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
        z.object({
          field: z.literal("characters"),
          edits: entryEditsSchema(
            collectionFields.characters.unwrap().element.omit({ id: true }),
          ),
        }),
        z.object({
          field: z.literal("locations"),
          edits: entryEditsSchema(
            collectionFields.locations.unwrap().element.omit({ id: true }),
          ),
        }),
        z.object({
          field: z.literal("voiceExemplars"),
          edits: entryEditsSchema(
            collectionFields.voiceExemplars.unwrap().element.omit({ id: true }),
          ),
        }),
      ]),
    )
    .min(1)
    .max(8),
});

export type StoryDetailsEditInput = z.infer<typeof storyDetailsEditSchema>;
// Persisted field replacements remain readable/resolvable for older proposals.
export type StoryDetailsFieldChange = {
  [Field in keyof StoryDetailsSnapshot]: {
    field: Field;
    before: StoryDetailsSnapshot[Field];
    after: StoryDetailsSnapshot[Field];
  };
}[keyof StoryDetailsSnapshot];

export type StoryDetailsCollectionField =
  | "characters"
  | "locations"
  | "voiceExemplars";
export type StoryDetailsEntryChange = {
  [Field in StoryDetailsCollectionField]: {
    field: Field;
    entryId: string;
    originalIndex: number;
    // Removal Undo uses surviving neighbors when other entries have changed.
    originalOrder?: string[];
    before: StoryDetailsSnapshot[Field][number] | null;
    after: StoryDetailsSnapshot[Field][number] | null;
  };
}[StoryDetailsCollectionField];
export type StoryDetailsChange =
  | StoryDetailsFieldChange
  | StoryDetailsEntryChange;

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
