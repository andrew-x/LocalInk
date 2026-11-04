import "server-only";

import { eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioStories } from "@/lib/drizzle/schema";
import type { StudioStoryDto, StudioVoiceSample } from "@/lib/studio/contracts";
import {
  applyStudioVoiceOps,
  markStaleSamples,
  STUDIO_VOICE_LIMITS,
  type StudioVoiceOp,
  type StudioVoiceState,
  studioVoiceFingerprint,
} from "@/lib/studio/voice";
import type {
  StagedStudioVoicePicks,
  StagedStudioVoiceSample,
} from "@/lib/studio/voice-contract";
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
  // A sample the same batch confirms stays fresh even when the batch changes
  // the voice (an undo restores picks and re-confirms what it made stale).
  const confirmed = new Set(
    ops.flatMap((op) => (op.kind === "confirm-sample" ? [op.sampleId] : [])),
  );
  const row = tx
    .update(studioStories)
    .set({
      genre: next.genre,
      voice: next.voice,
      voiceSamples: markStaleSamples(prev, next).map((sample) =>
        confirmed.has(sample.id) ? { ...sample, stale: false } : sample,
      ),
      updatedAt: day().toISOString(),
    })
    .where(eq(studioStories.id, storyId))
    .returning()
    .get();
  return toStoryDto(row);
}

function sameKind(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function writeVoiceState(
  tx: LocalinkTx,
  storyId: string,
  prev: Pick<StudioVoiceState, "genre" | "voice">,
  next: StudioVoiceState,
): StudioStoryDto {
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

/**
 * Appends staged picks. Kinds of moments are taken whole when the story has
 * none (setup); otherwise only kinds not already present are added.
 */
export function applyStagedStudioVoicePicks(
  tx: LocalinkTx,
  storyId: string,
  staged: StagedStudioVoicePicks,
): StudioStoryDto {
  const current = requireStudioStory(tx, storyId);
  const prev = { genre: current.genre, voice: current.voice };
  const taken = new Set(
    current.voice.picks.map((pick) => pick.label.trim().toLowerCase()),
  );
  const newPicks = staged.picks.filter(
    (pick) => !taken.has(pick.label.trim().toLowerCase()),
  );
  const picks = [...current.voice.picks, ...newPicks].slice(
    0,
    STUDIO_VOICE_LIMITS.picks,
  );
  let moments = current.voice.moments;
  if (moments.length === 0) {
    moments = staged.moments.slice(0, STUDIO_VOICE_LIMITS.moments);
  } else {
    for (const moment of staged.moments) {
      if (moments.length >= STUDIO_VOICE_LIMITS.moments) break;
      if (moments.some((item) => sameKind(item.kind, moment.kind))) continue;
      moments = [...moments, moment];
    }
  }
  const next: StudioVoiceState = {
    genre: current.genre,
    voice: { ...current.voice, picks, moments },
    samples: current.voiceSamples,
  };
  return writeVoiceState(tx, storyId, prev, next);
}

/** Keeps a staged sample, replacing any kept sample of the same kind. */
export function keepStagedStudioVoiceSample(
  tx: LocalinkTx,
  storyId: string,
  staged: StagedStudioVoiceSample,
): StudioStoryDto {
  const current = requireStudioStory(tx, storyId);
  if (
    staged.fingerprint !== studioVoiceFingerprint(current.genre, current.voice)
  ) {
    throw new ActionError(
      "BAD_REQUEST",
      "The voice changed after this sample was written. Use ↻ to rewrite it.",
    );
  }
  const sample: StudioVoiceSample = {
    id: generateId("voice-sample"),
    kind: staged.kind.trim(),
    text: staged.text,
    planItemId: staged.planItemId,
    source: "ai",
    stale: false,
  };
  const samples = [
    ...current.voiceSamples.filter((item) => !sameKind(item.kind, staged.kind)),
    sample,
  ];
  const moments = current.voice.moments.map((moment) =>
    sameKind(moment.kind, staged.kind) &&
    (moment.planItemId === null || staged.planItemId === null)
      ? { ...moment, planItemId: staged.planItemId }
      : moment,
  );
  const row = tx
    .update(studioStories)
    .set({
      voice: { ...current.voice, moments },
      voiceSamples: samples,
      updatedAt: day().toISOString(),
    })
    .where(eq(studioStories.id, storyId))
    .returning()
    .get();
  return toStoryDto(row);
}

/** Applies staged "choose" and "add-note" ops and computes their undo. */
export function applyStagedStudioVoiceChanges(
  tx: LocalinkTx,
  storyId: string,
  ops: StudioVoiceOp[],
): { story: StudioStoryDto; undoOps: StudioVoiceOp[] } {
  const before = requireStudioStory(tx, storyId);
  const story = patchStudioVoice(tx, storyId, ops);
  const undoOps: StudioVoiceOp[] = [];
  const restored = new Set<string>();
  for (const op of ops) {
    if (op.kind !== "choose" || restored.has(op.pickId)) continue;
    const pick = before.voice.picks.find((item) => item.id === op.pickId);
    if (!pick) continue;
    restored.add(op.pickId);
    undoOps.push({
      kind: "choose",
      pickId: pick.id,
      optionId: pick.chosenOptionId,
      custom: pick.custom,
    });
  }
  const knownNotes = new Set(before.voice.notes.map((note) => note.id));
  for (const note of story.voice.notes) {
    if (!knownNotes.has(note.id)) {
      undoOps.push({ kind: "remove-note", noteId: note.id });
    }
  }
  // Undo restores the picks, so it also restores the samples the apply made
  // stale; otherwise every tab would keep saying "Written before your changes".
  const staleNow = new Map(
    story.voiceSamples.map((sample) => [sample.id, sample.stale]),
  );
  for (const sample of before.voiceSamples) {
    if (!sample.stale && staleNow.get(sample.id) === true) {
      undoOps.push({ kind: "confirm-sample", sampleId: sample.id });
    }
  }
  return { story, undoOps };
}
