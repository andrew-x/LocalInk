"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTOSAVE_DELAY_MS = 800;

type Options<K extends string> = {
  /** What the store holds now; clean fields follow it. */
  serverValues: Record<K, string>;
  /**
   * `final` is true for blur and unmount flushes, false while typing.
   * Resolves true when saved, false when nothing was, or the keys to keep
   * local and dirty (for example an invalid value).
   */
  save: (
    changed: Partial<Record<K, string>>,
    final: boolean,
  ) => Promise<boolean | readonly K[]>;
  /**
   * Called when the hook starts or stops holding edits the store does not
   * have yet (typed but unsaved, or a save in flight or failed).
   */
  onDirtyChange?: (dirty: boolean) => void;
};

/**
 * Local drafts for a few text fields with an 800 ms debounced save. A field
 * the author has edited keeps its local value until a save lands, so the
 * store never overwrites what is being typed, and a failed save keeps it.
 * Pending edits are flushed on blur and on unmount. `flush` resolves true
 * when nothing is left unsaved.
 */
export function useAutosaveFields<K extends string>({
  onDirtyChange,
  save,
  serverValues,
}: Options<K>) {
  const [values, setValues] = useState(serverValues);
  const valuesRef = useRef(serverValues);
  const dirty = useRef(new Set<K>());
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    saveRef.current = save;
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange, save]);

  // The serialized values stand in for the object, which is rebuilt each render.
  const serverKey = JSON.stringify(serverValues);
  useEffect(() => {
    const server = JSON.parse(serverKey) as Record<K, string>;
    const next = { ...valuesRef.current };
    let changed = false;
    for (const key of Object.keys(server) as K[]) {
      if (!dirty.current.has(key) && next[key] !== server[key]) {
        next[key] = server[key];
        changed = true;
      }
    }
    if (!changed) return;
    valuesRef.current = next;
    setValues(next);
  }, [serverKey]);

  const flush = useCallback(async (final = false): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (dirty.current.size === 0) return true;
    const sent: Partial<Record<K, string>> = {};
    for (const key of dirty.current) sent[key] = valuesRef.current[key];
    const saved = await saveRef.current(sent, final);
    if (saved === false) return false;
    const keep = new Set<K>(saved === true ? [] : saved);
    for (const key of Object.keys(sent) as K[]) {
      if (keep.has(key)) continue;
      if (valuesRef.current[key] === sent[key]) dirty.current.delete(key);
    }
    // A save that landed may leave the store behind newer typing; that
    // typing stays dirty and saves next.
    if (dirty.current.size > 0) return false;
    onDirtyChangeRef.current?.(false);
    return true;
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => void flushRef.current(true), []);

  const setValue = useCallback(
    (key: K, value: string) => {
      valuesRef.current = { ...valuesRef.current, [key]: value };
      if (dirty.current.size === 0) onDirtyChangeRef.current?.(true);
      dirty.current.add(key);
      setValues(valuesRef.current);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  return { flush, setValue, values };
}
