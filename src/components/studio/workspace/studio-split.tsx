"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/util";

const DEFAULT_SHARE = 0.64;
const MIN_SHARE = 0.4;
const MAX_SHARE = 0.75;
const KEY_STEP = 0.02;

function clampShare(value: number): number {
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, value));
}

function storageKey(storyId: string): string {
  return `localink:studio-split:${storyId}`;
}

function readStoredShare(storyId: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey(storyId));
    if (raw === null) return null;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? clampShare(value) : null;
  } catch {
    return null;
  }
}

function storeShare(storyId: string, share: number) {
  try {
    window.localStorage.setItem(storageKey(storyId), String(share));
  } catch {
    // Storage can be blocked; the split still works for this visit.
  }
}

type StudioSplitProps = {
  storyId: string;
  /** The manuscript. */
  left: ReactNode;
  /** The plan pane. Stays mounted while hidden. */
  right: ReactNode;
  rightHidden: boolean;
};

/**
 * Manuscript on the left, plan pane on the right, with a draggable divider.
 * The manuscript's share is remembered per story. Below `lg` the right side
 * is a slide-over instead of a column.
 */
export function StudioSplit({
  storyId,
  left,
  right,
  rightHidden,
}: StudioSplitProps) {
  const [share, setShare] = useState(DEFAULT_SHARE);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef(share);

  // Read after mount so the server and first client render agree.
  useEffect(() => {
    const stored = readStoredShare(storyId);
    if (stored !== null) {
      shareRef.current = stored;
      setShare(stored);
    }
  }, [storyId]);

  function update(next: number, persist: boolean) {
    const clamped = clampShare(next);
    shareRef.current = clamped;
    setShare(clamped);
    if (persist) storeShare(storyId, clamped);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    update((event.clientX - rect.left) / rect.width, false);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
    storeShare(storyId, shareRef.current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP;
    update(shareRef.current + delta, true);
  }

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1",
        isDragging && "cursor-col-resize select-none",
      )}
      ref={containerRef}
      style={{ "--studio-split": `${share * 100}%` } as React.CSSProperties}
    >
      <section
        aria-label="Manuscript"
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto",
          !rightHidden && "lg:w-(--studio-split) lg:flex-none",
        )}
      >
        {left}
      </section>

      {rightHidden ? null : (
        // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or arrow keys; this is the ARIA window splitter.
        <div
          aria-label="Resize the manuscript and plan"
          aria-orientation="vertical"
          aria-valuemax={Math.round(MAX_SHARE * 100)}
          aria-valuemin={Math.round(MIN_SHARE * 100)}
          aria-valuenow={Math.round(share * 100)}
          className={cn(
            "group relative hidden w-1.5 shrink-0 cursor-col-resize touch-none outline-none lg:block",
            "bg-border/80 transition-colors hover:bg-primary/40 focus-visible:bg-primary/60",
            isDragging && "bg-primary/60",
          )}
          onKeyDown={handleKeyDown}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="separator"
          tabIndex={0}
        />
      )}

      <aside
        aria-label="Plan"
        className={cn(
          "flex min-h-0 min-w-0 flex-col bg-card/30",
          "max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-[min(28rem,92vw)] max-lg:border-border/80 max-lg:border-l max-lg:bg-background max-lg:shadow-2xl",
          "lg:flex-1",
          rightHidden && "hidden",
        )}
      >
        {right}
      </aside>
    </div>
  );
}
