"use client";

import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import Image from "next/image";
import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { GeneratedImageJob } from "@/components/generated-images/use-generated-image-jobs";
import day from "@/lib/dayjs";
import { cn } from "@/lib/util";

type GeneratedImageJobRailProps = {
  jobs: GeneratedImageJob[];
  onDismiss: (jobId: string) => void;
  onSelect: (jobId: string) => void;
  /** Focused when the rail empties out from under a keyboard user. */
  stageFallbackRef: React.RefObject<HTMLElement | null>;
  stagedJobId: string | null;
};

export function GeneratedImageJobRail({
  jobs,
  onDismiss,
  onSelect,
  stageFallbackRef,
  stagedJobId,
}: GeneratedImageJobRailProps) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  // Set when a removal unmounts the focused tile, applied once the list settles
  // so focus never falls back to <body>.
  const pendingFocusRef = useRef<string | null>(null);
  const [, setTick] = useState(0);
  const hasPendingJob = jobs.some((job) => job.status === "pending");

  useEffect(() => {
    if (!hasPendingJob) {
      return;
    }

    const interval = window.setInterval(() => {
      setTick((tick) => tick + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [hasPendingJob]);

  useLayoutEffect(() => {
    const targetId = pendingFocusRef.current;

    if (!targetId) {
      return;
    }

    pendingFocusRef.current = null;
    const target = itemRefs.current.get(targetId);

    if (target) {
      target.focus();
      return;
    }

    stageFallbackRef.current?.focus();
  }, [stageFallbackRef]);

  // One item means the workspace looks exactly as it did before concurrency.
  if (jobs.length <= 1) {
    return null;
  }

  const railJobs = [...jobs].reverse();

  function focusJob(jobId: string) {
    itemRefs.current.get(jobId)?.focus();
  }

  function handleRemove(jobId: string) {
    const index = railJobs.findIndex((job) => job.id === jobId);
    const neighbour = railJobs[index + 1] ?? railJobs[index - 1] ?? null;

    pendingFocusRef.current = neighbour?.id ?? null;
    onDismiss(jobId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = railJobs.findIndex((job) => job.id === stagedJobId);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        index < 0 ? 0 : (index + offset + railJobs.length) % railJobs.length;
      const nextJob = railJobs[nextIndex];

      if (nextJob) {
        onSelect(nextJob.id);
        focusJob(nextJob.id);
      }

      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();

      const nextJob =
        event.key === "Home" ? railJobs[0] : railJobs[railJobs.length - 1];

      if (nextJob) {
        onSelect(nextJob.id);
        focusJob(nextJob.id);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      stageFallbackRef.current?.focus();
    }
  }

  return (
    <aside className="flex w-20 shrink-0 flex-col border-border/80 border-l">
      <div
        aria-label="Session generations"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5"
        onKeyDown={handleKeyDown}
        role="listbox"
      >
        {railJobs.map((job, position) => {
          const isStaged = job.id === stagedJobId;
          const isRemovable = job.status !== "pending";

          return (
            // `presentation` keeps the option a valid child of the listbox
            // despite the wrapper the hover affordances need.
            <div className="group relative" key={job.id} role="presentation">
              <button
                aria-label={getJobLabel(
                  job,
                  railJobs.length - position,
                  railJobs.length,
                )}
                aria-selected={isStaged}
                className={cn(
                  "relative block aspect-square w-full overflow-hidden rounded-md border bg-card/70 outline-none transition-[border-color,box-shadow]",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/35",
                  isStaged
                    ? "border-primary/55 ring-2 ring-primary/45"
                    : "border-border/80 hover:border-ring/45",
                  job.status === "failed" &&
                    "border-destructive/40 bg-destructive/10",
                )}
                onClick={() => onSelect(job.id)}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(job.id, element);
                  } else {
                    itemRefs.current.delete(job.id);
                  }
                }}
                role="option"
                tabIndex={isStaged || (!stagedJobId && position === 0) ? 0 : -1}
                type="button"
              >
                <JobTile job={job} />
              </button>

              {job.isUnseen ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary ring-2 ring-card"
                />
              ) : null}

              {isRemovable ? (
                <button
                  aria-label="Remove from session"
                  className="absolute top-0.5 left-0.5 hidden size-5 items-center justify-center rounded-md border border-border/80 bg-background/85 text-muted-foreground backdrop-blur transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 group-focus-within:flex group-hover:flex"
                  onClick={() => handleRemove(job.id)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function JobTile({ job }: { job: GeneratedImageJob }) {
  if (job.status === "pending") {
    return (
      <span className="absolute inset-0 flex animate-pulse flex-col items-center justify-center gap-1 bg-muted/40">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin text-primary"
        />
        <span className="text-caption text-muted-foreground tabular-nums">
          {formatJobElapsed(job)}
        </span>
      </span>
    );
  }

  if (job.status === "failed") {
    return (
      <span className="absolute inset-0 flex items-center justify-center">
        <TriangleAlert aria-hidden="true" className="size-4 text-destructive" />
      </span>
    );
  }

  if (!job.image) {
    return null;
  }

  return (
    <Image
      alt=""
      className="object-cover"
      fill
      sizes="5rem"
      src={job.image.contentUrl}
      unoptimized
    />
  );
}

function getJobLabel(
  job: GeneratedImageJob,
  position: number,
  total: number,
): string {
  const base = `Generation ${position} of ${total}`;

  if (job.status === "pending") {
    return `${base}, generating, ${formatJobElapsed(job)}`;
  }

  if (job.status === "failed") {
    return `${base}, failed`;
  }

  return `${base}, complete${job.isUnseen ? ", new result" : ""}`;
}

/**
 * `src/lib/dayjs.ts` does not register the duration plugin, and `fromNow()` is
 * too coarse for a running timer, so elapsed time is a plain second diff.
 */
function formatJobElapsed(job: GeneratedImageJob): string {
  const end = job.settledAt ? day(job.settledAt) : day();
  const totalSeconds = Math.max(0, end.diff(day(job.startedAt), "second"));

  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
