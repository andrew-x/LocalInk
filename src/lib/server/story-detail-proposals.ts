import "server-only";

import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { getDb, type LocalinkDb, type LocalinkTx } from "@/lib/drizzle/db";
import { stories, storyChatDetailProposals } from "@/lib/drizzle/schema";
import { normalizeStoryCharacters } from "@/lib/server/story-characters";
import { normalizeStoryLocations } from "@/lib/server/story-locations";
import { normalizeStoryVoiceExemplars } from "@/lib/server/story-voice-exemplars";
import {
  type ResolveStoryDetailsProposalInput,
  type StoryDetailsChange,
  type StoryDetailsEditInput,
  type StoryDetailsProposal,
  type StoryDetailsProposalCandidate,
  type StoryDetailsSnapshot,
  storyDetailsEditSchema,
} from "@/lib/story-details-contract";

export type StoryDetailsProposalResolution = {
  proposal: StoryDetailsProposal;
  story: StoryDetailsSnapshot & { id: string; updatedAt: string };
};

function readStory(
  db: LocalinkDb | LocalinkTx,
  storyId: string,
): StoryDetailsProposalResolution["story"] {
  const story = db
    .select({
      id: stories.id,
      name: stories.name,
      description: stories.description,
      backstory: stories.backstory,
      style: stories.style,
      systemInstructions: stories.systemInstructions,
      characters: stories.characters,
      locations: stories.locations,
      voiceExemplars: stories.voiceExemplars,
      updatedAt: stories.updatedAt,
    })
    .from(stories)
    .where(eq(stories.id, storyId))
    .get();
  if (!story)
    throw new ActionError("BAD_REQUEST", "The story could not be found.");
  return story;
}

export async function getStoryDetailsSnapshot(
  storyId: string,
): Promise<StoryDetailsSnapshot> {
  const {
    id: _id,
    updatedAt: _updatedAt,
    ...snapshot
  } = readStory(getDb(), storyId);
  return snapshot;
}

function validateEntryIds(
  before: Array<{ id: string }>,
  after: Array<{ id?: string }>,
): void {
  const known = new Set(before.map((entry) => entry.id));
  const seen = new Set<string>();
  for (const entry of after) {
    if (entry.id === undefined) continue;
    if (!known.has(entry.id) || seen.has(entry.id)) {
      throw new ActionError(
        "BAD_REQUEST",
        "Story detail edits must preserve existing entry IDs; new entries must omit their ID.",
      );
    }
    seen.add(entry.id);
  }
}

export function buildStoryDetailsProposal(
  snapshot: StoryDetailsSnapshot,
  input: StoryDetailsEditInput,
): StoryDetailsProposalCandidate {
  const parsed = storyDetailsEditSchema.safeParse(input);
  if (!parsed.success)
    throw new ActionError(
      "BAD_REQUEST",
      "The story detail proposal contains invalid fields or values. Please request a revised proposal.",
    );
  const seen = new Set<keyof StoryDetailsSnapshot>();
  const changes: StoryDetailsChange[] = parsed.data.changes.map((change) => {
    if (seen.has(change.field))
      throw new ActionError(
        "BAD_REQUEST",
        "A story detail field may only appear once in a proposal.",
      );
    seen.add(change.field);
    let normalized: StoryDetailsChange;
    switch (change.field) {
      case "characters":
        validateEntryIds(snapshot.characters, change.after);
        normalized = {
          ...change,
          before: snapshot.characters,
          after: normalizeStoryCharacters(change.after),
        };
        break;
      case "locations":
        validateEntryIds(snapshot.locations, change.after);
        normalized = {
          ...change,
          before: snapshot.locations,
          after: normalizeStoryLocations(change.after),
        };
        break;
      case "voiceExemplars":
        validateEntryIds(snapshot.voiceExemplars, change.after);
        normalized = {
          ...change,
          before: snapshot.voiceExemplars,
          after: normalizeStoryVoiceExemplars(change.after),
        };
        break;
      default:
        normalized = { ...change, before: snapshot[change.field] };
    }
    if (isDeepStrictEqual(normalized.before, normalized.after))
      throw new ActionError(
        "BAD_REQUEST",
        "The story detail proposal includes an unchanged field. Please propose only changed fields.",
      );
    return normalized;
  });
  return structuredClone({ summary: parsed.data.summary, changes });
}

function readProposal(
  tx: LocalinkTx,
  storyId: string,
  proposalId: string,
): StoryDetailsProposal {
  const proposal = tx
    .select()
    .from(storyChatDetailProposals)
    .where(
      and(
        eq(storyChatDetailProposals.id, proposalId),
        eq(storyChatDetailProposals.storyId, storyId),
      ),
    )
    .get();
  if (!proposal)
    throw new ActionError(
      "BAD_REQUEST",
      "The story detail proposal could not be found.",
    );
  return proposal;
}

export async function getStoryDetailsProposal(
  storyId: string,
  proposalId: string,
): Promise<StoryDetailsProposalResolution> {
  return getDb().transaction((tx) => ({
    proposal: readProposal(tx, storyId, proposalId),
    story: readStory(tx, storyId),
  }));
}

export async function resolveStoryDetailsProposal(
  input: ResolveStoryDetailsProposalInput,
): Promise<StoryDetailsProposalResolution> {
  return getDb().transaction((tx) => {
    const proposal = readProposal(tx, input.storyId, input.proposalId);
    const story = readStory(tx, input.storyId);
    const targetStatus =
      input.decision === "approve"
        ? "accepted"
        : input.decision === "deny"
          ? "rejected"
          : "undone";
    // Resolve retries before baseline checks so a lost response cannot apply an edit twice.
    if (proposal.status === targetStatus) return { proposal, story };
    if (
      proposal.status !== (input.decision === "undo" ? "accepted" : "pending")
    )
      throw new ActionError(
        "BAD_REQUEST",
        "This story detail proposal has already been resolved. Reload the chat to see its current status.",
      );
    const now = day().toISOString();
    if (input.decision !== "deny") {
      const updates: Partial<typeof stories.$inferInsert> = { updatedAt: now };
      for (const change of proposal.changes) {
        const baseline =
          input.decision === "undo" ? change.after : change.before;
        if (!isDeepStrictEqual(story[change.field], baseline))
          throw new ActionError(
            "CONFLICT",
            "The affected story details have changed since this proposal. Your changes were preserved; request a new proposal for the current details.",
          );
        Object.assign(updates, {
          [change.field]:
            input.decision === "undo" ? change.before : change.after,
        });
      }
      tx.update(stories)
        .set(updates)
        .where(eq(stories.id, input.storyId))
        .run();
    }
    tx.update(storyChatDetailProposals)
      .set({ status: targetStatus, updatedAt: now })
      .where(eq(storyChatDetailProposals.id, proposal.id))
      .run();
    return {
      proposal: { ...proposal, status: targetStatus, updatedAt: now },
      story: readStory(tx, input.storyId),
    };
  });
}
