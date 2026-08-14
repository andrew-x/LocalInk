"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GenerateImageFormValues } from "@/actions/generated-images/_schemas";
import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import day from "@/lib/dayjs";
import {
  GENERATE_IMAGE_ROUTE_PATH,
  type GenerateImageRouteError,
  MAX_CONCURRENT_IMAGE_GENERATIONS,
} from "@/lib/generated-image-generation-contract";
import { generateId } from "@/lib/util";

/**
 * Settled jobs stay in the tray so the rail can show the session's history, but
 * an unbounded list would keep mounting thumbnails in a long session.
 */
const MAX_TRACKED_JOBS = 12;

export type GeneratedImageJobStatus = "pending" | "complete" | "failed";

export type GeneratedImageJob = {
  id: string;
  status: GeneratedImageJobStatus;
  /** Exactly what was sent, so the rail can label and re-fire the job. */
  values: GenerateImageFormValues;
  startedAt: string;
  /** Set when the job settles, which freezes the elapsed label. */
  settledAt: string | null;
  image: GeneratedImageListItem | null;
  /** Sanitized and user-facing. Only set on "failed". */
  errorMessage: string | null;
  /** True until the job is staged or dismissed. Drives the rail badge. */
  isUnseen: boolean;
};

type UseGeneratedImageJobsOptions = {
  defaultValues: GenerateImageFormValues;
  initialImage: GeneratedImageListItem | null;
  onJobSettled: (job: GeneratedImageJob) => void;
};

export function useGeneratedImageJobs({
  defaultValues,
  initialImage,
  onJobSettled,
}: UseGeneratedImageJobsOptions) {
  const [jobs, setJobs] = useState<GeneratedImageJob[]>(() =>
    initialImage ? [toSeedJob(initialImage, defaultValues)] : [],
  );
  // Mirrors `jobs` so callbacks can read the current list without taking it as
  // a dependency, which would churn their identity on every settle.
  const jobsRef = useRef(jobs);
  // Cancellation is not a feature yet, so nothing aborts in flight. This only
  // stops a settling job from writing state into an unmounted component.
  const isMountedRef = useRef(true);
  const onJobSettledRef = useRef(onJobSettled);

  useEffect(() => {
    onJobSettledRef.current = onJobSettled;
  }, [onJobSettled]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const commit = useCallback((next: GeneratedImageJob[]) => {
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const settleJob = useCallback(
    (jobId: string, patch: Partial<GeneratedImageJob>) => {
      if (!isMountedRef.current) {
        return;
      }

      const existing = jobsRef.current.find((job) => job.id === jobId);

      if (existing?.status !== "pending") {
        return;
      }

      const settledJob: GeneratedImageJob = {
        ...existing,
        ...patch,
        settledAt: day().toISOString(),
      };

      commit(
        pruneJobs(
          jobsRef.current.map((job) => (job.id === jobId ? settledJob : job)),
        ),
      );
      onJobSettledRef.current(settledJob);
    },
    [commit],
  );

  const startJob = useCallback(
    (values: GenerateImageFormValues): string | null => {
      const activeJobCount = jobsRef.current.filter(
        (job) => job.status === "pending",
      ).length;

      if (activeJobCount >= MAX_CONCURRENT_IMAGE_GENERATIONS) {
        return null;
      }

      const jobId = generateId("image-job");

      commit(
        pruneJobs([
          ...jobsRef.current,
          {
            id: jobId,
            status: "pending",
            values,
            startedAt: day().toISOString(),
            settledAt: null,
            image: null,
            errorMessage: null,
            isUnseen: true,
          },
        ]),
      );

      void requestGeneratedImage(values)
        .then((image) => {
          settleJob(jobId, { status: "complete", image });
        })
        .catch((error: unknown) => {
          settleJob(jobId, {
            status: "failed",
            errorMessage: toUserFacingMessage(error),
          });
        });

      return jobId;
    },
    [commit, settleJob],
  );

  const dismissJob = useCallback(
    (jobId: string) => {
      commit(
        jobsRef.current.filter(
          (job) => job.id !== jobId || job.status === "pending",
        ),
      );
    },
    [commit],
  );

  const markJobSeen = useCallback(
    (jobId: string) => {
      commit(
        jobsRef.current.map((job) =>
          job.id === jobId && job.isUnseen ? { ...job, isUnseen: false } : job,
        ),
      );
    },
    [commit],
  );

  const activeCount = jobs.filter((job) => job.status === "pending").length;

  return {
    activeCount,
    dismissJob,
    isAtConcurrencyLimit: activeCount >= MAX_CONCURRENT_IMAGE_GENERATIONS,
    jobs,
    markJobSeen,
    startJob,
  };
}

async function requestGeneratedImage(
  values: GenerateImageFormValues,
): Promise<GeneratedImageListItem> {
  const response = await fetch(GENERATE_IMAGE_ROUTE_PATH, {
    body: JSON.stringify(values),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    const routeError = (await response
      .json()
      .catch(() => null)) as GenerateImageRouteError | null;

    throw new Error(routeError?.message ?? "The image could not be generated.");
  }

  return (await response.json()) as GeneratedImageListItem;
}

function toUserFacingMessage(error: unknown): string {
  // Route errors already carry a sanitized public message. Anything else is a
  // transport failure, whose text should not be shown verbatim.
  return error instanceof Error && error.message
    ? error.message
    : "The image could not be generated.";
}

/**
 * The prefilled image becomes job zero so the rail, the stage, and the lightbox
 * all read from one uniform list instead of special-casing it everywhere.
 */
function toSeedJob(
  image: GeneratedImageListItem,
  values: GenerateImageFormValues,
): GeneratedImageJob {
  return {
    id: generateId("image-job"),
    status: "complete",
    values,
    startedAt: image.createdAt,
    settledAt: image.createdAt,
    image,
    errorMessage: null,
    isUnseen: false,
  };
}

/** Drops the oldest settled, already-seen jobs once the tray outgrows its cap. */
function pruneJobs(jobs: GeneratedImageJob[]): GeneratedImageJob[] {
  if (jobs.length <= MAX_TRACKED_JOBS) {
    return jobs;
  }

  const dropCount = jobs.length - MAX_TRACKED_JOBS;
  const dropIds = new Set(
    jobs
      .filter((job) => job.status !== "pending" && !job.isUnseen)
      .slice(0, dropCount)
      .map((job) => job.id),
  );

  return jobs.filter((job) => !dropIds.has(job.id));
}
