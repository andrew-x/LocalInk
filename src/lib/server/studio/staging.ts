import "server-only";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { generateId } from "@/lib/util";

export type StudioStageBinding = {
  storyId: string;
  /** "chat": targetId is the thread id. */
  kind: "plan" | "moment-prose" | "read-back" | "undo-delete" | "chat";
  targetId: string;
  generationId: string;
};

type Stage = {
  binding: string;
  attemptId: string;
  expiresAt: number;
  bytes: number;
  output?: unknown;
};

// A staged result can sit on screen for a long time before the author keeps
// or applies it, so it lives for hours and every read pushes expiry back.
const STAGE_TTL_MS = 6 * 60 * 60 * 1000;
const UNDO_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 50;
const MAX_BYTES = 64 * 1024 * 1024;
const stageGlobal = globalThis as typeof globalThis & {
  __localinkStudioStages?: Map<string, Stage>;
};
stageGlobal.__localinkStudioStages ??= new Map();
const stages = stageGlobal.__localinkStudioStages;

function bindingKey(binding: StudioStageBinding): string {
  return JSON.stringify([
    binding.storyId,
    binding.kind,
    binding.targetId,
    binding.generationId,
  ]);
}

function prune(): void {
  const now = day().valueOf();
  for (const [key, stage] of stages) {
    if (stage.expiresAt <= now) stages.delete(key);
  }
}

function unavailable(): ActionError {
  return new ActionError(
    "BAD_REQUEST",
    "This generated result is no longer available. Please generate it again.",
  );
}

/**
 * With a long TTL, abandoned results (a discarded draft, an alternative never
 * picked) accumulate, so a full pool evicts the finished result that was
 * touched least recently instead of refusing new work. Running generations
 * are never evicted. Returns false when nothing could be evicted.
 */
function evictLeastRecentFinished(keep?: string): boolean {
  let oldestKey: string | undefined;
  let oldestExpiry = Number.POSITIVE_INFINITY;
  for (const [key, stage] of stages) {
    if (key === keep || stage.output === undefined) continue;
    if (stage.expiresAt < oldestExpiry) {
      oldestExpiry = stage.expiresAt;
      oldestKey = key;
    }
  }
  if (oldestKey === undefined) return false;
  stages.delete(oldestKey);
  return true;
}

function totalBytes(): number {
  return [...stages.values()].reduce((total, item) => total + item.bytes, 0);
}

export function beginStudioStage(binding: StudioStageBinding): string {
  prune();
  if (stages.has(binding.generationId)) {
    throw new ActionError(
      "BAD_REQUEST",
      "This generation is already running or ready to save.",
    );
  }
  while (stages.size >= MAX_ENTRIES) {
    if (!evictLeastRecentFinished()) {
      throw new ActionError(
        "GENERATION_FAILED",
        "Too many generations are waiting to finish. Please try again shortly.",
      );
    }
  }
  const attemptId = generateId("studio-attempt");
  stages.set(binding.generationId, {
    binding: bindingKey(binding),
    attemptId,
    expiresAt: day().valueOf() + STAGE_TTL_MS,
    bytes: 0,
  });
  return attemptId;
}

export function finishStudioStage<T>(
  binding: StudioStageBinding,
  attemptId: string,
  output: T,
): void {
  prune();
  const stage = stages.get(binding.generationId);
  if (
    !stage ||
    stage.binding !== bindingKey(binding) ||
    stage.attemptId !== attemptId ||
    stage.output !== undefined
  )
    throw unavailable();
  const bytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  while (bytes + totalBytes() > MAX_BYTES) {
    if (!evictLeastRecentFinished(binding.generationId)) break;
  }
  if (bytes + totalBytes() > MAX_BYTES) {
    stages.delete(binding.generationId);
    throw new ActionError(
      "GENERATION_FAILED",
      "The generated result is too large to hold right now. Please try a smaller request.",
    );
  }
  // Copy so callers cannot modify the staged result after handing it over.
  stage.output = structuredClone(output);
  stage.bytes = bytes;
  stage.expiresAt = day().valueOf() + STAGE_TTL_MS;
}

/** Reads a staged result and pushes its expiry back by a full TTL. */
export function getStudioStage<T>(binding: StudioStageBinding): T {
  prune();
  const stage = stages.get(binding.generationId);
  if (
    !stage ||
    stage.output === undefined ||
    stage.binding !== bindingKey(binding)
  )
    throw unavailable();
  stage.expiresAt = day().valueOf() + STAGE_TTL_MS;
  return structuredClone(stage.output) as T;
}

export function failStudioStage(
  binding: StudioStageBinding,
  attemptId: string,
): void {
  const stage = stages.get(binding.generationId);
  if (
    stage?.binding === bindingKey(binding) &&
    stage.attemptId === attemptId &&
    stage.output === undefined
  )
    stages.delete(binding.generationId);
}

export function dropStudioStage(binding: StudioStageBinding): void {
  if (stages.get(binding.generationId)?.binding === bindingKey(binding))
    stages.delete(binding.generationId);
}

// Undo snapshots live in their own small pool so a delete never competes
// with, or fails because of, in-flight generations.
type UndoEntry = {
  storyId: string;
  expiresAt: number;
  bytes: number;
  snapshot: unknown;
};

const UNDO_MAX_ENTRIES = 20;
const undoGlobal = globalThis as typeof globalThis & {
  __localinkStudioUndo?: Map<string, UndoEntry>;
};
undoGlobal.__localinkStudioUndo ??= new Map();
const undoStages = undoGlobal.__localinkStudioUndo;

function pruneUndo(): void {
  const now = day().valueOf();
  for (const [token, entry] of undoStages) {
    if (entry.expiresAt <= now) undoStages.delete(token);
  }
}

function undoUnavailable(): ActionError {
  return new ActionError(
    "BAD_REQUEST",
    "Undo is no longer available for this delete.",
  );
}

/** Stores a snapshot and returns its token. Evicts the oldest when full. */
export function putStudioUndo<T>(storyId: string, snapshot: T): string {
  pruneUndo();
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (bytes > MAX_BYTES) {
    throw new ActionError(
      "GENERATION_FAILED",
      "This is too large to delete with undo support. Delete smaller parts instead.",
    );
  }
  const total = () =>
    [...undoStages.values()].reduce((sum, item) => sum + item.bytes, 0);
  // Maps iterate in insertion order, so the first key is the oldest.
  while (
    undoStages.size > 0 &&
    (undoStages.size >= UNDO_MAX_ENTRIES || total() + bytes > MAX_BYTES)
  ) {
    const oldest = undoStages.keys().next().value;
    if (oldest === undefined) break;
    undoStages.delete(oldest);
  }
  const token = generateId("studio-undo");
  undoStages.set(token, {
    storyId,
    expiresAt: day().valueOf() + UNDO_TTL_MS,
    bytes,
    snapshot: structuredClone(snapshot),
  });
  return token;
}

export function getStudioUndo<T>(storyId: string, token: string): T {
  pruneUndo();
  const entry = undoStages.get(token);
  if (!entry || entry.storyId !== storyId) throw undoUnavailable();
  return structuredClone(entry.snapshot) as T;
}

export function dropStudioUndo(storyId: string, token: string): void {
  if (undoStages.get(token)?.storyId === storyId) undoStages.delete(token);
}
