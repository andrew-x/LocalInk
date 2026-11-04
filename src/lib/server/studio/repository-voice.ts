import "server-only";

import { eq } from "drizzle-orm";

import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioStories } from "@/lib/drizzle/schema";
import type { StudioStoryDto } from "@/lib/studio/contracts";
import {
  applyStudioVoiceOps,
  markStaleSamples,
  type StudioVoiceOp,
} from "@/lib/studio/voice";
import { generateId } from "@/lib/util";

import { requireStudioStory, toStoryDto } from "./repository";

/** Applies voice ops to genre, voice and kept samples in one write. */
export function patchStudioVoice(
  tx: LocalinkTx,
  storyId: string,
  ops: StudioVoiceOp[],
): StudioStoryDto {
  const current = requireStudioStory(tx, storyId);
  const prev = { genre: current.genre, voice: current.voice };
  const next = applyStudioVoiceOps(
    { ...prev, samples: current.voiceSamples },
    ops,
    generateId,
  );
  const row = tx
    .update(studioStories)
    .set({
      genre: next.genre,
      voice: next.voice,
      voiceSamples: markStaleSamples(prev, next),
      updatedAt: day().toISOString(),
    })
    .where(eq(studioStories.id, storyId))
    .returning()
    .get();
  return toStoryDto(row);
}
