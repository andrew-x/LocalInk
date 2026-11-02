"use client";

import { type RefObject, useEffect } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";

const THROTTLE_MS = 150;
/** The reading line sits this far down the manuscript viewport. */
const READING_LINE = 0.3;

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Tells the outline where the reader is. The rule: the reading moment is the
 * last moment (in document order) whose top edge is at or above the line 30%
 * down the manuscript viewport, which is the moment the line crosses. An
 * IntersectionObserver whose root is clipped to the top 30% of the viewport
 * tracks the moments overlapping that band, and the last of them wins. At the
 * very top of the page the first moment wins. Updates run at most every
 * 150 ms; `momentKey` re-observes when the rendered moments change.
 */
export function useReadingPosition(
  containerRef: RefObject<HTMLElement | null>,
  momentKey: string,
) {
  const { dispatch } = useStudioStore();

  // biome-ignore lint/correctness/useExhaustiveDependencies: momentKey re-observes after moments mount or unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scroller = scrollParent(container);
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-moment-id]"),
    );
    if (elements.length === 0) return;

    const inBand = new Set<HTMLElement>();
    let lastRun = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = () => {
      timer = null;
      lastRun = Date.now();
      let picked: HTMLElement | undefined;
      if (scroller && scroller.scrollTop <= 0) {
        picked = elements[0];
      } else {
        for (const element of elements) {
          if (inBand.has(element)) picked = element;
        }
      }
      const momentId = picked?.dataset.momentId;
      if (momentId) dispatch({ type: "setReading", itemId: momentId });
    };
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
      timer = setTimeout(evaluate, wait);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (entry.isIntersecting) inBand.add(element);
          else inBand.delete(element);
        }
        schedule();
      },
      {
        root: scroller,
        rootMargin: `0px 0px -${Math.round((1 - READING_LINE) * 100)}% 0px`,
      },
    );
    for (const element of elements) observer.observe(element);
    scroller?.addEventListener("scroll", schedule, { passive: true });

    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", schedule);
      if (timer) clearTimeout(timer);
    };
  }, [containerRef, dispatch, momentKey]);
}
