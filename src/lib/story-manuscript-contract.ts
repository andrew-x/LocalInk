import { z } from "zod";

const idSchema = z.string().trim().min(1);

export const manuscriptSnapshotSchema = z.object({
  chapters: z.array(
    z.object({
      id: idSchema,
      content: z.string(),
      contentRevision: z.number().int().nonnegative(),
    }),
  ),
  focusedChapterId: idSchema.nullable(),
  selection: z
    .object({
      chapterId: idSchema,
      text: z.string(),
    })
    .nullable(),
});

export type ManuscriptSnapshot = z.infer<typeof manuscriptSnapshotSchema>;

export type ManuscriptEditHunk = {
  before: string;
  after: string;
  start: number;
};

export type ManuscriptProposalChapter = {
  chapterId: string;
  chapterName: string;
  before: string;
  after: string;
  edits: ManuscriptEditHunk[];
};

export type ManuscriptProposalCandidate = {
  summary: string;
  chapters: ManuscriptProposalChapter[];
};

export type ManuscriptProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "undone";

export type ManuscriptProposal = ManuscriptProposalCandidate & {
  id: string;
  storyId: string;
  chatId: string;
  messageId: string;
  generationId: string;
  status: ManuscriptProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type ManuscriptProposalDecision = "approve" | "deny" | "undo";

export type ResolveManuscriptProposalInput = {
  storyId: string;
  proposalId: string;
  decision: ManuscriptProposalDecision;
  expectedRevisions: Array<{ chapterId: string; contentRevision: number }>;
};
