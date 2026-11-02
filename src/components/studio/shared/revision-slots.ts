/**
 * Per-record save slots for compare-and-swap saves. Saves for one record
 * serialize on `queue`, each against the newest revision seen in `newest`.
 */
export type RevisionSlot<T extends { revision: number }> = {
  queue: Promise<unknown>;
  newest: T | null;
};

export function createRevisionSlots<T extends { revision: number }>() {
  const slots = new Map<string, RevisionSlot<T>>();
  return function getSlot(key: string): RevisionSlot<T> {
    let slot = slots.get(key);
    if (!slot) {
      slot = { queue: Promise.resolve(), newest: null };
      slots.set(key, slot);
    }
    return slot;
  };
}

/** The record to save against: the stored copy, or a newer one a save returned. */
export function newestRevision<T extends { revision: number }>(
  stored: T | undefined,
  slot: RevisionSlot<T>,
): T | undefined {
  const seen = slot.newest;
  return stored && seen && seen.revision > stored.revision ? seen : stored;
}
