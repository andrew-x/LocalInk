import "server-only";

import { eq } from "drizzle-orm";

import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioChanges, studioPlanItems } from "@/lib/drizzle/schema";
import { modeForLabel, normalizeAspect } from "@/lib/studio/aspects";
import type { StudioChangeDto, StudioChangeMode } from "@/lib/studio/contracts";

import { toChangeDto, toPlanItemDto } from "./repository";

export type AspectModeResolver = {
  /**
   * The mode an AI-written change must use. A label the entry already tracks
   * keeps its existing mode (a different one would collapse or fork its
   * list); a new label keeps the proposed mode and fixes it for later uses.
   * Only the author's change form may change a label's mode.
   */
  resolve: (
    entryId: string,
    aspect: string,
    proposed: StudioChangeMode,
  ) => StudioChangeMode;
};

export function createAspectModeResolver(
  tx: LocalinkTx,
  storyId: string,
): AspectModeResolver {
  const changes: StudioChangeDto[] = tx
    .select()
    .from(studioChanges)
    .where(eq(studioChanges.storyId, storyId))
    .all()
    .map(toChangeDto);
  const planItems = tx
    .select()
    .from(studioPlanItems)
    .where(eq(studioPlanItems.storyId, storyId))
    .all()
    .map(toPlanItemDto);
  const decided = new Map<string, StudioChangeMode>();
  return {
    resolve(entryId, aspect, proposed) {
      const key = JSON.stringify([entryId, normalizeAspect(aspect)]);
      const known =
        decided.get(key) ?? modeForLabel(changes, entryId, aspect, planItems);
      const mode = known ?? proposed;
      decided.set(key, mode);
      return mode;
    },
  };
}
