import "server-only";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { ManuscriptProposalCandidate } from "@/lib/story-manuscript-contract";
import { generateId } from "@/lib/util";

export type StoryChatGenerationBinding = {
  storyId: string;
  chatId: string;
  generationId: string;
  contextMessageId: string;
  replaceAssistantMessageId?: string;
};

type StagedOutput = { content: string; proposal?: ManuscriptProposalCandidate };
type Stage = {
  binding: string;
  attemptId: string;
  expiresAt: number;
  bytes: number;
  output?: StagedOutput;
};

const TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 50;
const MAX_BYTES = 64 * 1024 * 1024;
const stageGlobal = globalThis as typeof globalThis & {
  __localinkStoryChatStages?: Map<string, Stage>;
};
stageGlobal.__localinkStoryChatStages ??= new Map();
const stages = stageGlobal.__localinkStoryChatStages;

function bindingKey(binding: StoryChatGenerationBinding): string {
  return JSON.stringify([
    binding.storyId,
    binding.chatId,
    binding.generationId,
    binding.contextMessageId,
    binding.replaceAssistantMessageId ?? null,
  ]);
}

function prune(): void {
  const now = day().valueOf();
  for (const [key, stage] of stages) {
    if (stage.expiresAt <= now) stages.delete(key);
  }
}

function expired(): ActionError {
  return new ActionError(
    "BAD_REQUEST",
    "This generated reply is no longer available. Please generate it again.",
  );
}

export function beginStoryChatGeneration(
  binding: StoryChatGenerationBinding,
): string {
  prune();
  if (stages.has(binding.generationId)) {
    throw new ActionError(
      "BAD_REQUEST",
      "This chat generation is already running or ready to save.",
    );
  }
  if (stages.size >= MAX_ENTRIES) {
    throw new ActionError(
      "GENERATION_FAILED",
      "Too many chat generations are waiting to finish. Please try again shortly.",
    );
  }
  const attemptId = generateId("story-chat-attempt");
  stages.set(binding.generationId, {
    binding: bindingKey(binding),
    attemptId,
    expiresAt: day().valueOf() + TTL_MS,
    bytes: 0,
  });
  return attemptId;
}

export function finishStoryChatGeneration(
  binding: StoryChatGenerationBinding,
  attemptId: string,
  output: StagedOutput,
): void {
  prune();
  const stage = stages.get(binding.generationId);
  if (
    !stage ||
    stage.binding !== bindingKey(binding) ||
    stage.attemptId !== attemptId ||
    stage.output
  )
    throw expired();
  const bytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
  const totalBytes = [...stages.values()].reduce(
    (total, item) => total + item.bytes,
    0,
  );
  if (bytes + totalBytes > MAX_BYTES) {
    stages.delete(binding.generationId);
    throw new ActionError(
      "GENERATION_FAILED",
      "The generated reply is too large to save right now. Please request a smaller edit.",
    );
  }
  // Copy so callers cannot modify the reviewed candidate after staging it.
  stage.output = structuredClone(output);
  stage.bytes = bytes;
  stage.expiresAt = day().valueOf() + TTL_MS;
}

export function getStagedStoryChatGeneration(
  binding: StoryChatGenerationBinding,
): StagedOutput {
  prune();
  const stage = stages.get(binding.generationId);
  if (!stage?.output || stage.binding !== bindingKey(binding)) throw expired();
  return structuredClone(stage.output);
}

export function failStoryChatGeneration(
  binding: StoryChatGenerationBinding,
  attemptId: string,
): void {
  const stage = stages.get(binding.generationId);
  if (
    stage?.binding === bindingKey(binding) &&
    stage.attemptId === attemptId &&
    !stage.output
  )
    stages.delete(binding.generationId);
}

export function dropStagedStoryChatGeneration(
  binding: StoryChatGenerationBinding,
): void {
  if (stages.get(binding.generationId)?.binding === bindingKey(binding))
    stages.delete(binding.generationId);
}
