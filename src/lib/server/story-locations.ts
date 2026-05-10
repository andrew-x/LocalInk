import "server-only";

import type { StoryLocation } from "@/lib/drizzle/schema";
import { generateId } from "@/lib/util";

const MAX_LOCATION_ID_LENGTH = 128;

export type StoryLocationInput = Omit<StoryLocation, "id"> &
  Partial<Pick<StoryLocation, "id">>;

export function normalizeStoryLocations(
  locations: readonly StoryLocationInput[],
): StoryLocation[] {
  const usedIds = new Set<string>();

  return locations.map((location) => {
    const id = getUniqueLocationId(location.id, usedIds);
    usedIds.add(id);

    return {
      id,
      name: location.name,
      description: location.description,
    };
  });
}

function getUniqueLocationId(
  candidateId: string | undefined,
  usedIds: Set<string>,
) {
  const normalizedCandidateId = candidateId?.trim();

  if (
    normalizedCandidateId &&
    normalizedCandidateId.length <= MAX_LOCATION_ID_LENGTH &&
    !usedIds.has(normalizedCandidateId)
  ) {
    return normalizedCandidateId;
  }

  let generatedId = "";

  do {
    generatedId = generateId("location");
  } while (usedIds.has(generatedId));

  return generatedId;
}
