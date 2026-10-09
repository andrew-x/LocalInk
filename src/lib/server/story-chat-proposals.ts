import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { StoryChapterItem } from "@/actions/stories/_types";
import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkTx } from "@/lib/drizzle/db";
import {
  chapters,
  stories,
  storyChatEditProposals,
} from "@/lib/drizzle/schema";
import { storyChapterSelectFields } from "@/lib/server/story-chapters";
import type {
  ManuscriptProposal,
  ResolveManuscriptProposalInput,
} from "@/lib/story-manuscript-contract";

export type ManuscriptProposalResolution = {
  proposal: ManuscriptProposal;
  chapters: StoryChapterItem[];
};

function readProposal(
  tx: LocalinkTx,
  storyId: string,
  proposalId: string,
): ManuscriptProposal {
  const proposal = tx
    .select()
    .from(storyChatEditProposals)
    .where(
      and(
        eq(storyChatEditProposals.id, proposalId),
        eq(storyChatEditProposals.storyId, storyId),
      ),
    )
    .get();
  if (!proposal)
    throw new ActionError(
      "BAD_REQUEST",
      "The manuscript proposal could not be found.",
    );
  return proposal;
}

function readChapters(
  tx: LocalinkTx,
  proposal: ManuscriptProposal,
): StoryChapterItem[] {
  const ids = proposal.chapters.map((chapter) => chapter.chapterId);
  if (!ids.length) return [];
  return tx
    .select(storyChapterSelectFields)
    .from(chapters)
    .where(
      and(eq(chapters.storyId, proposal.storyId), inArray(chapters.id, ids)),
    )
    .all();
}

export async function getManuscriptProposal(
  storyId: string,
  proposalId: string,
): Promise<ManuscriptProposalResolution> {
  return getDb().transaction((tx) => {
    const proposal = readProposal(tx, storyId, proposalId);
    return { proposal, chapters: readChapters(tx, proposal) };
  });
}

export async function resolveManuscriptProposal(
  input: ResolveManuscriptProposalInput,
): Promise<ManuscriptProposalResolution> {
  return getDb().transaction((tx) => {
    const proposal = readProposal(tx, input.storyId, input.proposalId);
    const targetStatus =
      input.decision === "approve"
        ? "accepted"
        : input.decision === "deny"
          ? "rejected"
          : "undone";
    // Return the durable result before checking revisions: retrying a lost response
    // must never apply or reverse the same proposal twice.
    if (proposal.status === targetStatus) {
      return { proposal, chapters: readChapters(tx, proposal) };
    }
    const requiredStatus = input.decision === "undo" ? "accepted" : "pending";
    if (proposal.status !== requiredStatus) {
      throw new ActionError(
        "BAD_REQUEST",
        "This manuscript proposal has already been resolved. Reload the chat to see its current status.",
      );
    }
    const now = day().toISOString();
    if (input.decision !== "deny") {
      const currentChapters = readChapters(tx, proposal);
      const expected = new Map(
        input.expectedRevisions.map((chapter) => [
          chapter.chapterId,
          chapter.contentRevision,
        ]),
      );
      if (
        expected.size !== input.expectedRevisions.length ||
        expected.size !== proposal.chapters.length ||
        currentChapters.length !== proposal.chapters.length
      ) {
        throw new ActionError(
          "CONFLICT",
          "The affected chapters have changed. Review the current manuscript and request a new proposal.",
        );
      }
      for (const proposed of proposal.chapters) {
        const current = currentChapters.find(
          (chapter) => chapter.id === proposed.chapterId,
        );
        const baseline =
          input.decision === "undo" ? proposed.after : proposed.before;
        if (
          !current ||
          current.content !== baseline ||
          current.contentRevision !== expected.get(current.id)
        ) {
          throw new ActionError(
            "CONFLICT",
            "The manuscript has changed since this proposal. Your writing was preserved; request a new proposal for the current text.",
          );
        }
      }
      for (const proposed of proposal.chapters) {
        const revision = expected.get(proposed.chapterId);
        if (revision === undefined) {
          throw new ActionError(
            "CONFLICT",
            "The affected chapters have changed. Please review the current manuscript.",
          );
        }
        tx.update(chapters)
          .set({
            content:
              input.decision === "undo" ? proposed.before : proposed.after,
            contentRevision: revision + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(chapters.id, proposed.chapterId),
              eq(chapters.storyId, input.storyId),
            ),
          )
          .run();
      }
      tx.update(stories)
        .set({ updatedAt: now })
        .where(eq(stories.id, input.storyId))
        .run();
    }
    tx.update(storyChatEditProposals)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(storyChatEditProposals.id, proposal.id))
      .run();
    const resolved: ManuscriptProposal = {
      ...proposal,
      status: targetStatus,
      updatedAt: now,
    };
    return { proposal: resolved, chapters: readChapters(tx, resolved) };
  });
}
