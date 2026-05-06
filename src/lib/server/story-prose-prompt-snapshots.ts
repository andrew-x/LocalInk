import "server-only";

import { randomUUID } from "node:crypto";

import day from "@/lib/dayjs";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

const MAX_PROMPT_SNAPSHOTS = 50;
const PROMPT_SNAPSHOT_TTL_MS = 4 * 60 * 60 * 1000;

export type StoryProsePromptSnapshot = {
  approximateLength: StoryProseGenerationRequest["approximateLength"];
  createdAt: string;
  id: string;
  mode: "first-generation" | "fresh-alternative" | "revise-prior-draft";
  prompt: string;
  system: string;
};

type StoredPromptSnapshot = StoryProsePromptSnapshot & {
  createdAtMs: number;
};

const promptSnapshots = new Map<string, StoredPromptSnapshot>();

export function saveStoryProsePromptSnapshot({
  approximateLength,
  prompt,
  regeneration,
  system,
}: {
  approximateLength: StoryProseGenerationRequest["approximateLength"];
  prompt: string;
  regeneration: StoryProseGenerationRequest["regeneration"];
  system: string;
}): StoryProsePromptSnapshot {
  pruneExpiredPromptSnapshots();

  const createdAt = day();
  const snapshot: StoredPromptSnapshot = {
    approximateLength,
    createdAt: createdAt.toISOString(),
    createdAtMs: createdAt.valueOf(),
    id: randomUUID(),
    mode: getSnapshotMode(regeneration),
    prompt,
    system,
  };

  promptSnapshots.set(snapshot.id, snapshot);
  pruneOldestPromptSnapshots();

  return toPublicPromptSnapshot(snapshot);
}

export function getStoryProsePromptSnapshot(
  id: string,
): StoryProsePromptSnapshot | null {
  pruneExpiredPromptSnapshots();

  const snapshot = promptSnapshots.get(id);

  if (!snapshot) {
    return null;
  }

  return toPublicPromptSnapshot(snapshot);
}

function pruneExpiredPromptSnapshots() {
  const expiresBeforeMs = day().valueOf() - PROMPT_SNAPSHOT_TTL_MS;

  for (const [id, snapshot] of promptSnapshots) {
    if (snapshot.createdAtMs < expiresBeforeMs) {
      promptSnapshots.delete(id);
    }
  }
}

function pruneOldestPromptSnapshots() {
  while (promptSnapshots.size > MAX_PROMPT_SNAPSHOTS) {
    const oldestId = promptSnapshots.keys().next().value;

    if (!oldestId) {
      return;
    }

    promptSnapshots.delete(oldestId);
  }
}

function toPublicPromptSnapshot(
  snapshot: StoredPromptSnapshot,
): StoryProsePromptSnapshot {
  return {
    approximateLength: snapshot.approximateLength,
    createdAt: snapshot.createdAt,
    id: snapshot.id,
    mode: snapshot.mode,
    prompt: snapshot.prompt,
    system: snapshot.system,
  };
}

function getSnapshotMode(
  regeneration: StoryProseGenerationRequest["regeneration"],
): StoryProsePromptSnapshot["mode"] {
  if (regeneration?.mode === "fresh-alternative") {
    return "fresh-alternative";
  }

  if (regeneration?.mode === "revise-prior-draft") {
    return "revise-prior-draft";
  }

  return "first-generation";
}
