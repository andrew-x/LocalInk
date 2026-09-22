import "server-only";

import type { StoryVoiceExemplar } from "@/lib/drizzle/schema";
import { generateId } from "@/lib/util";

const MAX_VOICE_EXEMPLAR_ID_LENGTH = 128;

export type StoryVoiceExemplarInput = Omit<StoryVoiceExemplar, "id"> &
  Partial<Pick<StoryVoiceExemplar, "id">>;

export function normalizeStoryVoiceExemplars(
  voiceExemplars: readonly StoryVoiceExemplarInput[],
): StoryVoiceExemplar[] {
  const usedIds = new Set<string>();

  return voiceExemplars.map((voiceExemplar) => {
    const id = getUniqueVoiceExemplarId(voiceExemplar.id, usedIds);
    usedIds.add(id);

    return {
      id,
      label: voiceExemplar.label,
      text: voiceExemplar.text,
    };
  });
}

function getUniqueVoiceExemplarId(
  candidateId: string | undefined,
  usedIds: Set<string>,
) {
  const normalizedCandidateId = candidateId?.trim();

  if (
    normalizedCandidateId &&
    normalizedCandidateId.length <= MAX_VOICE_EXEMPLAR_ID_LENGTH &&
    !usedIds.has(normalizedCandidateId)
  ) {
    return normalizedCandidateId;
  }

  let generatedId = "";

  do {
    generatedId = generateId("voice-exemplar");
  } while (usedIds.has(generatedId));

  return generatedId;
}
