/**
 * Module-level registry linking the manuscript's selection toolbar to the Voice
 * tab's tuning card. The card cannot hold a Lexical editor or selection, so the
 * toolbar registers a closure that replaces the held passage and the card takes
 * it when the author keeps the rewrite.
 */
type VoiceTuneEntry = {
  id: string;
  momentId: string;
  replace(markdown: string): boolean;
};

const entries = new Map<string, VoiceTuneEntry>();

export function registerVoiceTune(entry: VoiceTuneEntry): void {
  entries.set(entry.id, entry);
}

/** Removes and returns the entry, or null when it was dropped meanwhile. */
export function takeVoiceTune(
  id: string,
): Pick<VoiceTuneEntry, "momentId" | "replace"> | null {
  const entry = entries.get(id);
  if (!entry) return null;
  entries.delete(id);
  return { momentId: entry.momentId, replace: entry.replace };
}

export function dropVoiceTune(id: string): void {
  entries.delete(id);
}

export function dropVoiceTunesForMoment(momentId: string): void {
  for (const [id, entry] of entries) {
    if (entry.momentId === momentId) entries.delete(id);
  }
}
