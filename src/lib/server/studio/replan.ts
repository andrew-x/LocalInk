import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import type { LocalinkTx } from "@/lib/drizzle/db";
import {
  studioPlanItems,
  studioProse,
  studioProseVersions,
} from "@/lib/drizzle/schema";

export type StudioReplaceableBeat = { id: string; revision: number };

/**
 * The beats of a scene that a replan may replace: no prose, no prose history,
 * and no field the author owns. Every other beat is kept as it is.
 */
export function listReplaceableBeats(
  tx: LocalinkTx,
  storyId: string,
  sceneId: string,
): StudioReplaceableBeat[] {
  const beats = tx
    .select({
      id: studioPlanItems.id,
      revision: studioPlanItems.revision,
      authorFields: studioPlanItems.authorFields,
      position: studioPlanItems.position,
    })
    .from(studioPlanItems)
    .where(
      and(
        eq(studioPlanItems.storyId, storyId),
        eq(studioPlanItems.parentId, sceneId),
        eq(studioPlanItems.kind, "moment"),
      ),
    )
    .all()
    .sort((a, b) => a.position - b.position);
  if (beats.length === 0) return [];

  const ids = beats.map((beat) => beat.id);
  const kept = new Set(
    tx
      .select({
        momentId: studioProse.momentId,
        markdown: studioProse.markdown,
      })
      .from(studioProse)
      .where(inArray(studioProse.momentId, ids))
      .all()
      .filter((row) => row.markdown.trim())
      .map((row) => row.momentId),
  );
  for (const row of tx
    .selectDistinct({ momentId: studioProseVersions.momentId })
    .from(studioProseVersions)
    .where(inArray(studioProseVersions.momentId, ids))
    .all()) {
    kept.add(row.momentId);
  }

  return beats
    .filter((beat) => beat.authorFields.length === 0 && !kept.has(beat.id))
    .map(({ id, revision }) => ({ id, revision }));
}
