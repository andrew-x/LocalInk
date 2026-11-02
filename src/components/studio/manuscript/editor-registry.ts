"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level registry of the mounted moment editors, in the spirit of a
 * tiny external store. There is one workspace per page and every key is a
 * moment id, so a module singleton is enough.
 */

export type MomentSaveState = "saved" | "pending" | "saving" | "error";

export type MomentEditorHandle = {
  focusStart(): void;
  focusEnd(): void;
  /**
   * Saves pending edits. Resolves to the acknowledged prose revision, or null
   * when the moment could not be saved (its text stays in the editor).
   */
  flush?(): Promise<number | null>;
  /** Retries a failed save with the same expected revision. */
  retry?(): void;
};

/** The DOM attribute that orders editors for keyboard navigation. */
export const STUDIO_EDITOR_ATTRIBUTE = "data-studio-editor";

const editors = new Map<string, MomentEditorHandle>();

export function registerMomentEditor(
  momentId: string,
  handle: MomentEditorHandle,
): () => void {
  editors.set(momentId, handle);
  return () => {
    if (editors.get(momentId) === handle) editors.delete(momentId);
  };
}

/**
 * Flushes the moment's editor when one is mounted. Resolves to the revision
 * to use for a compare-and-swap write, `fallbackRevision` when no editor is
 * mounted, or null when pending edits could not be saved.
 */
export async function flushMomentEditor(
  momentId: string,
  fallbackRevision: number,
): Promise<number | null> {
  const handle = editors.get(momentId);
  if (!handle?.flush) return fallbackRevision;
  return handle.flush();
}

/**
 * Flushes every mounted editor among `momentIds`, in parallel. Resolves false
 * when any of them could not save, so callers never act on stale prose.
 */
export async function flushMomentEditors(
  momentIds: string[],
): Promise<boolean> {
  const pending = momentIds.flatMap((id) => {
    const flush = editors.get(id)?.flush;
    return flush ? [flush()] : [];
  });
  const revisions = await Promise.all(pending);
  return revisions.every((revision) => revision !== null);
}

export function retryMomentSave(momentId: string): void {
  editors.get(momentId)?.retry?.();
}

/**
 * Retries every failed save among `momentIds` and scrolls the first of those
 * editors (in document order) into view, so the author sees which text it is.
 */
export function retryMomentSaves(momentIds: readonly string[]): void {
  for (const id of momentIds) retryMomentSave(id);
  if (typeof document === "undefined") return;
  const ids = new Set(momentIds);
  const first = Array.from(
    document.querySelectorAll<HTMLElement>(`[${STUDIO_EDITOR_ATTRIBUTE}]`),
  ).find((element) =>
    ids.has(element.getAttribute(STUDIO_EDITOR_ATTRIBUTE) ?? ""),
  );
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * Moves focus to the nearest mounted editor before or after `momentId` in
 * document order. Focus happens on the next tick so a caller inside a Lexical
 * command never nests another editor's update. Returns whether one exists.
 */
export function focusNeighbor(
  momentId: string,
  direction: "prev" | "next",
  edge: "start" | "end",
): boolean {
  if (typeof document === "undefined") return false;
  const ids = Array.from(
    document.querySelectorAll<HTMLElement>(`[${STUDIO_EDITOR_ATTRIBUTE}]`),
    (element) => element.getAttribute(STUDIO_EDITOR_ATTRIBUTE) ?? "",
  );
  const index = ids.indexOf(momentId);
  if (index === -1) return false;
  const step = direction === "prev" ? -1 : 1;
  for (let i = index + step; i >= 0 && i < ids.length; i += step) {
    const handle = editors.get(ids[i]);
    if (!handle) continue;
    window.setTimeout(() => {
      if (edge === "start") handle.focusStart();
      else handle.focusEnd();
    }, 0);
    return true;
  }
  return false;
}

// Save states per moment, for UI that reports whether prose is saved.

export type UnsavedMoments = {
  /** Moments whose save failed: their text exists only in the editor. */
  blockedIds: readonly string[];
  /** Any moment has edits not saved yet (failed, waiting, or saving). */
  hasUnsaved: boolean;
};

const NOTHING_UNSAVED: UnsavedMoments = { blockedIds: [], hasUnsaved: false };

const saveStates = new Map<string, MomentSaveState>();
const saveStateListeners = new Set<() => void>();
// Rebuilt only when it changes, so subscribers re-render on transitions.
let unsavedSnapshot = NOTHING_UNSAVED;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function notifySaveStates() {
  const blockedIds: string[] = [];
  let hasUnsaved = false;
  for (const [momentId, state] of saveStates) {
    if (state === "error") blockedIds.push(momentId);
    if (state !== "saved") hasUnsaved = true;
  }
  if (
    hasUnsaved !== unsavedSnapshot.hasUnsaved ||
    !sameIds(blockedIds, unsavedSnapshot.blockedIds)
  ) {
    unsavedSnapshot = hasUnsaved ? { blockedIds, hasUnsaved } : NOTHING_UNSAVED;
  }
  for (const listener of saveStateListeners) listener();
}

export function setMomentSaveState(momentId: string, state: MomentSaveState) {
  if (saveStates.get(momentId) === state) return;
  saveStates.set(momentId, state);
  notifySaveStates();
}

export function clearMomentSaveState(momentId: string) {
  if (!saveStates.delete(momentId)) return;
  notifySaveStates();
}

function subscribeSaveStates(listener: () => void) {
  saveStateListeners.add(listener);
  return () => {
    saveStateListeners.delete(listener);
  };
}

/** Which mounted moment editors hold text that is not saved. */
export function useUnsavedMoments(): UnsavedMoments {
  return useSyncExternalStore(
    subscribeSaveStates,
    () => unsavedSnapshot,
    () => NOTHING_UNSAVED,
  );
}
