"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTOSAVE_DELAY_MS = 800;

type Options<K extends string> = {
  /** What the store holds now; clean fields follow it. */
  serverValues: Record<K, string>;
  /** Resolves true once the changed fields are saved. */
  save: (changed: Partial<Record<K, string>>) => Promise<boolean>;
};

/**
 * Local drafts for a few text fields with an 800 ms debounced save. A field
 * the author has edited keeps its local value until a save lands, so the
 * store never overwrites what is being typed, and a failed save keeps it.
 * Pending edits are flushed on blur and on unmount.
 */
export function useAutosaveFields<K extends string>({
  save,
  serverValues,
}: Options<K>) {
  const [values, setValues] = useState(serverValues);
  const valuesRef = useRef(serverValues);
  const dirty = useRef(new Set<K>());
  const timer = useRef<number | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

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

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (dirty.current.size === 0) return;
    const sent: Partial<Record<K, string>> = {};
    for (const key of dirty.current) sent[key] = valuesRef.current[key];
    const saved = await saveRef.current(sent);
    if (!saved) return;
    for (const key of Object.keys(sent) as K[]) {
      if (valuesRef.current[key] === sent[key]) dirty.current.delete(key);
    }
    // A save that landed may leave the store behind newer typing; nothing to do.
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => void flushRef.current(), []);

  const setValue = useCallback(
    (key: K, value: string) => {
      valuesRef.current = { ...valuesRef.current, [key]: value };
      dirty.current.add(key);
      setValues(valuesRef.current);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  return { flush, setValue, values };
}
