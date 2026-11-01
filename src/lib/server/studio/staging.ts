import "server-only";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import { generateId } from "@/lib/util";

export type StudioStageBinding = {
  storyId: string;
  kind: "plan" | "moment-prose" | "read-back" | "undo-delete";
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

const TTL_MS = 15 * 60 * 1000;
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

export function beginStudioStage(binding: StudioStageBinding): string {
  prune();
  if (stages.has(binding.generationId)) {
    throw new ActionError(
      "BAD_REQUEST",
      "This generation is already running or ready to save.",
    );
  }
  if (stages.size >= MAX_ENTRIES) {
    throw new ActionError(
      "GENERATION_FAILED",
      "Too many generations are waiting to finish. Please try again shortly.",
    );
  }
  const attemptId = generateId("studio-attempt");
  stages.set(binding.generationId, {
    binding: bindingKey(binding),
    attemptId,
    expiresAt: day().valueOf() + TTL_MS,
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
  const totalBytes = [...stages.values()].reduce(
    (total, item) => total + item.bytes,
    0,
  );
  if (bytes + totalBytes > MAX_BYTES) {
    stages.delete(binding.generationId);
    throw new ActionError(
      "GENERATION_FAILED",
      "The generated result is too large to hold right now. Please try a smaller request.",
    );
  }
  // Copy so callers cannot modify the staged result after handing it over.
  stage.output = structuredClone(output);
  stage.bytes = bytes;
  stage.expiresAt = day().valueOf() + TTL_MS;
}

export function getStudioStage<T>(binding: StudioStageBinding): T {
  prune();
  const stage = stages.get(binding.generationId);
  if (
    !stage ||
    stage.output === undefined ||
    stage.binding !== bindingKey(binding)
  )
    throw unavailable();
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
