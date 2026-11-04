import type {
  StudioVoice,
  StudioVoiceMoment,
  StudioVoiceNote,
  StudioVoiceOption,
  StudioVoicePick,
  StudioVoiceSample,
} from "@/lib/studio/contracts";
import { hashText } from "@/lib/studio/prose-text";

export const STUDIO_VOICE_LIMITS = {
  genreLabels: 4,
  genreLabelChars: 40,
  picks: 12,
  options: 4,
  pickTextChars: 200,
  customChars: 300,
  notes: 20,
  noteChars: 300,
  moments: 6,
  kindChars: 60,
  sampleChars: 2_000,
} as const;

/** Most kept samples a prompt carries. */
export const STUDIO_MAX_PROMPT_SAMPLES = 6;

export type StudioVoiceOp =
  | {
      kind: "choose";
      pickId: string;
      optionId: string | null;
      custom: string | null;
    }
  | { kind: "remove-pick"; pickId: string }
  | { kind: "add-note"; text: string; origin: "author" | "ai" }
  | { kind: "edit-note"; noteId: string; text: string }
  | { kind: "remove-note"; noteId: string }
  | { kind: "set-genre"; genre: string[] }
  | { kind: "add-moment"; label: string }
  | { kind: "remove-moment"; momentId: string }
  | { kind: "confirm-sample"; sampleId: string }
  | { kind: "remove-sample"; sampleId: string };

export type StudioVoiceState = {
  genre: string[];
  voice: StudioVoice;
  samples: StudioVoiceSample[];
};

function clip(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

function sameKind(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function cleanGenre(genre: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of genre) {
    const label = clip(raw, STUDIO_VOICE_LIMITS.genreLabelChars);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= STUDIO_VOICE_LIMITS.genreLabels) break;
  }
  return result;
}

/** `custom` wins, then the chosen option, then the suggested one. */
export function effectivePickChoice(pick: StudioVoicePick): {
  option: StudioVoiceOption | null;
  custom: string | null;
} {
  const custom = pick.custom?.trim();
  if (custom) return { option: null, custom };
  const optionId = pick.chosenOptionId ?? pick.suggestedOptionId;
  const option = pick.options.find((o) => o.id === optionId) ?? null;
  return { option, custom: null };
}

/** Genre plus each pick's effective choice. Notes never count. */
export function studioVoiceFingerprint(
  genre: string[],
  voice: StudioVoice,
): string {
  const parts = voice.picks.map((pick) => {
    const { option, custom } = effectivePickChoice(pick);
    return [pick.id, custom !== null ? `c:${custom}` : `o:${option?.id ?? ""}`];
  });
  return hashText(JSON.stringify([genre, parts]));
}

export function applyStudioVoiceOps(
  state: StudioVoiceState,
  ops: StudioVoiceOp[],
  newId: (prefix: string) => string,
): StudioVoiceState {
  let genre = state.genre;
  let picks = state.voice.picks;
  let notes = state.voice.notes;
  let moments = state.voice.moments;
  let samples = state.samples;

  for (const op of ops) {
    switch (op.kind) {
      case "choose": {
        const target = picks.find((pick) => pick.id === op.pickId);
        if (!target) break;
        const optionId =
          op.optionId !== null &&
          target.options.some((option) => option.id === op.optionId)
            ? op.optionId
            : null;
        const custom = op.custom
          ? clip(op.custom, STUDIO_VOICE_LIMITS.customChars) || null
          : null;
        picks = picks.map((pick) =>
          pick.id === op.pickId
            ? { ...pick, chosenOptionId: optionId, custom }
            : pick,
        );
        break;
      }
      case "remove-pick":
        picks = picks.filter((pick) => pick.id !== op.pickId);
        break;
      case "add-note": {
        const text = clip(op.text, STUDIO_VOICE_LIMITS.noteChars);
        if (!text || notes.length >= STUDIO_VOICE_LIMITS.notes) break;
        const note: StudioVoiceNote = {
          id: newId("voice-note"),
          text,
          origin: op.origin,
        };
        notes = [...notes, note];
        break;
      }
      case "edit-note": {
        const text = clip(op.text, STUDIO_VOICE_LIMITS.noteChars);
        if (!text) break;
        notes = notes.map((note) =>
          note.id === op.noteId ? { ...note, text } : note,
        );
        break;
      }
      case "remove-note":
        notes = notes.filter((note) => note.id !== op.noteId);
        break;
      case "set-genre":
        genre = cleanGenre(op.genre);
        break;
      case "add-moment": {
        const kind = clip(op.label, STUDIO_VOICE_LIMITS.kindChars);
        if (!kind || moments.length >= STUDIO_VOICE_LIMITS.moments) break;
        if (moments.some((moment) => sameKind(moment.kind, kind))) break;
        const moment: StudioVoiceMoment = {
          id: newId("voice-moment"),
          kind,
          planItemId: null,
        };
        moments = [...moments, moment];
        break;
      }
      case "remove-moment": {
        const target = moments.find((moment) => moment.id === op.momentId);
        if (!target) break;
        moments = moments.filter((moment) => moment.id !== op.momentId);
        samples = samples.filter(
          (sample) => !sameKind(sample.kind, target.kind),
        );
        break;
      }
      case "confirm-sample":
        samples = samples.map((sample) =>
          sample.id === op.sampleId ? { ...sample, stale: false } : sample,
        );
        break;
      case "remove-sample":
        samples = samples.filter((sample) => sample.id !== op.sampleId);
        break;
    }
  }

  return { genre, voice: { picks, notes, moments }, samples };
}

/** Every kept sample goes stale when genre or any effective pick changes. */
export function markStaleSamples(
  prev: Pick<StudioVoiceState, "genre" | "voice">,
  next: StudioVoiceState,
): StudioVoiceSample[] {
  if (
    studioVoiceFingerprint(prev.genre, prev.voice) ===
    studioVoiceFingerprint(next.genre, next.voice)
  ) {
    return next.samples;
  }
  return next.samples.map((sample) =>
    sample.stale ? sample : { ...sample, stale: true },
  );
}

/** Fresh, non-empty samples in moment order; legacy kinds come last. */
export function promptVoiceSamples(story: {
  voice: StudioVoice;
  voiceSamples: StudioVoiceSample[];
}): StudioVoiceSample[] {
  const usable = story.voiceSamples.filter(
    (sample) => !sample.stale && sample.text.trim().length > 0,
  );
  const ordered: StudioVoiceSample[] = [];
  const taken = new Set<string>();
  for (const moment of story.voice.moments) {
    for (const sample of usable) {
      if (taken.has(sample.id) || !sameKind(sample.kind, moment.kind)) continue;
      taken.add(sample.id);
      ordered.push(sample);
    }
  }
  for (const sample of usable) {
    if (!taken.has(sample.id)) ordered.push(sample);
  }
  return ordered.slice(0, STUDIO_MAX_PROMPT_SAMPLES);
}

export function isStudioVoiceSetUp(story: {
  voice: StudioVoice;
  voiceSamples: StudioVoiceSample[];
}): boolean {
  return story.voice.picks.length > 0 || story.voiceSamples.length > 0;
}

function describeChoice(pick: StudioVoicePick): string {
  const { option, custom } = effectivePickChoice(pick);
  return custom ?? option?.label ?? "Not set";
}

/** A short line for a review list, or null when the op names nothing. */
export function describeStudioVoiceOp(
  op: StudioVoiceOp,
  voice: StudioVoice,
): string | null {
  switch (op.kind) {
    case "choose": {
      const pick = voice.picks.find((p) => p.id === op.pickId);
      if (!pick) return null;
      const [after] = applyStudioVoiceOps(
        {
          genre: [],
          voice: { ...voice, picks: [pick], notes: [], moments: [] },
          samples: [],
        },
        [op],
        (prefix) => prefix,
      ).voice.picks;
      if (!after) return null;
      return `${pick.label}: ${describeChoice(pick)} → ${describeChoice(after)}`;
    }
    case "remove-pick": {
      const pick = voice.picks.find((p) => p.id === op.pickId);
      return pick ? `Removed: ${pick.label}` : null;
    }
    case "add-note": {
      const text = clip(op.text, STUDIO_VOICE_LIMITS.noteChars);
      return text ? `New note: ${text}` : null;
    }
    case "edit-note": {
      const text = clip(op.text, STUDIO_VOICE_LIMITS.noteChars);
      return text && voice.notes.some((n) => n.id === op.noteId)
        ? `Edited note: ${text}`
        : null;
    }
    case "remove-note": {
      const note = voice.notes.find((n) => n.id === op.noteId);
      return note ? `Removed note: ${note.text}` : null;
    }
    case "set-genre": {
      const genre = cleanGenre(op.genre);
      return genre.length > 0 ? `Genre: ${genre.join(", ")}` : "Genre cleared";
    }
    case "add-moment": {
      const kind = clip(op.label, STUDIO_VOICE_LIMITS.kindChars);
      return kind ? `New kind of moment: ${kind}` : null;
    }
    case "remove-moment": {
      const moment = voice.moments.find((m) => m.id === op.momentId);
      return moment ? `Removed kind of moment: ${moment.kind}` : null;
    }
    case "confirm-sample":
    case "remove-sample":
      return null;
  }
}
