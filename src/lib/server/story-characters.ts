import "server-only";

import type { StoryCharacter } from "@/lib/drizzle/schema";
import { generateId } from "@/lib/util";

const MAX_CHARACTER_ID_LENGTH = 128;

export type StoryCharacterInput = Omit<StoryCharacter, "id"> &
  Partial<Pick<StoryCharacter, "id">>;

export function normalizeStoryCharacters(
  characters: readonly StoryCharacterInput[],
): StoryCharacter[] {
  const usedIds = new Set<string>();

  return characters.map((character) => {
    const id = getUniqueCharacterId(character.id, usedIds);
    usedIds.add(id);

    return {
      id,
      name: character.name,
      description: character.description,
    };
  });
}

function getUniqueCharacterId(
  candidateId: string | undefined,
  usedIds: Set<string>,
) {
  const normalizedCandidateId = candidateId?.trim();

  if (
    normalizedCandidateId &&
    normalizedCandidateId.length <= MAX_CHARACTER_ID_LENGTH &&
    !usedIds.has(normalizedCandidateId)
  ) {
    return normalizedCandidateId;
  }

  let generatedId = "";

  do {
    generatedId = generateId("character");
  } while (usedIds.has(generatedId));

  return generatedId;
}
