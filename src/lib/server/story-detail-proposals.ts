import "server-only";

import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";

import { updateStoryActionSchema } from "@/actions/stories/_schemas";
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

const storyDetailsValuesSchema = updateStoryActionSchema.omit({ id: true });

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

type EntryEdit<Entry> =
  | { operation: "add"; after: Omit<Entry, "id"> }
  | { operation: "update"; id: string; after: Omit<Entry, "id"> }
  | { operation: "remove"; id: string };

type EntryChange<Entry> = {
  entryId: string;
  originalIndex: number;
  originalOrder?: string[];
  before: Entry | null;
  after: Entry | null;
};

function buildEntryChanges<Entry extends { id: string }>(
  entries: Entry[],
  edits: EntryEdit<Entry>[],
  normalize: (entries: Omit<Entry, "id">[]) => Entry[],
): EntryChange<Entry>[] {
  const seen = new Set<string>();
  return edits.map((edit) => {
    if (edit.operation === "add") {
      const after = normalize([edit.after])[0];
      return {
        entryId: after.id,
        originalIndex: entries.length,
        before: null,
        after,
      };
    }
    const originalIndex = entries.findIndex((entry) => entry.id === edit.id);
    if (originalIndex === -1 || seen.has(edit.id))
      throw new ActionError(
        "BAD_REQUEST",
        "Each story detail entry must exist and may only be edited once in a proposal.",
      );
    seen.add(edit.id);
    const before = entries[originalIndex];
    const after =
      edit.operation === "remove"
        ? null
        : ({ ...edit.after, id: before.id } as Entry);
    if (isDeepStrictEqual(before, after))
      throw new ActionError(
        "BAD_REQUEST",
        "The story detail proposal includes an unchanged entry. Please propose only changed entries.",
      );
    return {
      entryId: before.id,
      originalIndex,
      ...(edit.operation === "remove"
        ? { originalOrder: entries.map((entry) => entry.id) }
        : {}),
      before,
      after,
    };
  });
}

function detailsConflict(): never {
  throw new ActionError(
    "CONFLICT",
    "The affected story details have changed since this proposal. Your changes were preserved; request a new proposal for the current details.",
  );
}

function applyEntryChange<Entry extends { id: string }>(
  entries: Entry[],
  change: EntryChange<Entry>,
  undo: boolean,
): Entry[] {
  const baseline = undo ? change.after : change.before;
  const replacement = undo ? change.before : change.after;
  const index = entries.findIndex((entry) => entry.id === change.entryId);
  if (!isDeepStrictEqual(index === -1 ? null : entries[index], baseline))
    detailsConflict();
  const result = [...entries];
  if (replacement === null) {
    if (index !== -1) result.splice(index, 1);
  } else if (index !== -1) {
    result[index] = replacement;
  } else {
    // New entries append; Undo follows surviving neighbors, not stale indices.
    const insertionIndex = undo
      ? getRestoredEntryIndex(result, change)
      : result.length;
    result.splice(insertionIndex, 0, replacement);
  }
  return result;
}

function getRestoredEntryIndex<Entry extends { id: string }>(
  entries: Entry[],
  change: EntryChange<Entry>,
): number {
  if (change.originalOrder) {
    for (const id of change.originalOrder.slice(change.originalIndex + 1)) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index !== -1) return index;
    }
    for (const id of change.originalOrder
      .slice(0, change.originalIndex)
      .reverse()) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index !== -1) return index + 1;
    }
  }
  return Math.min(change.originalIndex, entries.length);
}

function applyDetailsChanges(
  story: StoryDetailsSnapshot,
  changes: StoryDetailsChange[],
  undo: boolean,
): Partial<StoryDetailsSnapshot> {
  const updates: Partial<StoryDetailsSnapshot> = {};
  // Reverse entry removals in original order so Undo restores list order too.
  const orderedChanges = undo
    ? [...changes].sort((left, right) =>
        "entryId" in left && "entryId" in right && left.field === right.field
          ? left.originalIndex - right.originalIndex
          : 0,
      )
    : changes;
  for (const change of orderedChanges) {
    if ("entryId" in change) {
      switch (change.field) {
        case "characters":
          updates.characters = applyEntryChange(
            updates.characters ?? story.characters,
            change,
            undo,
          );
          break;
        case "locations":
          updates.locations = applyEntryChange(
            updates.locations ?? story.locations,
            change,
            undo,
          );
          break;
        case "voiceExemplars":
          updates.voiceExemplars = applyEntryChange(
            updates.voiceExemplars ?? story.voiceExemplars,
            change,
            undo,
          );
          break;
      }
    } else {
      const baseline = undo ? change.after : change.before;
      if (!isDeepStrictEqual(story[change.field], baseline)) detailsConflict();
      Object.assign(updates, {
        [change.field]: undo ? change.before : change.after,
      });
    }
  }
  return updates;
}

function validateUpdatedDetails(
  updates: Partial<StoryDetailsSnapshot>,
  code: "BAD_REQUEST" | "CONFLICT",
): void {
  if (!storyDetailsValuesSchema.safeParse(updates).success)
    throw new ActionError(
      code,
      "The proposed story details would exceed a story limit or contain invalid values. Your details were preserved; request a revised proposal.",
    );
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
  const changes: StoryDetailsChange[] = [];
  for (const change of parsed.data.changes) {
    if (seen.has(change.field))
      throw new ActionError(
        "BAD_REQUEST",
        "A story detail field may only appear once in a proposal; group its entry edits together.",
      );
    seen.add(change.field);
    switch (change.field) {
      case "characters":
        changes.push(
          ...buildEntryChanges(
            snapshot.characters,
            change.edits,
            normalizeStoryCharacters,
          ).map((entry) => ({ ...entry, field: "characters" as const })),
        );
        break;
      case "locations":
        changes.push(
          ...buildEntryChanges(
            snapshot.locations,
            change.edits,
            normalizeStoryLocations,
          ).map((entry) => ({ ...entry, field: "locations" as const })),
        );
        break;
      case "voiceExemplars":
        changes.push(
          ...buildEntryChanges(
            snapshot.voiceExemplars,
            change.edits,
            normalizeStoryVoiceExemplars,
          ).map((entry) => ({ ...entry, field: "voiceExemplars" as const })),
        );
        break;
      default:
        if (isDeepStrictEqual(snapshot[change.field], change.after))
          throw new ActionError(
            "BAD_REQUEST",
            "The story detail proposal includes an unchanged field. Please propose only changed fields.",
          );
        changes.push({ ...change, before: snapshot[change.field] });
    }
  }
  validateUpdatedDetails(
    applyDetailsChanges(snapshot, changes, false),
    "BAD_REQUEST",
  );
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
      const updates = applyDetailsChanges(
        story,
        proposal.changes,
        input.decision === "undo",
      );
      validateUpdatedDetails(updates, "CONFLICT");
      tx.update(stories)
        .set({ ...updates, updatedAt: now })
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
