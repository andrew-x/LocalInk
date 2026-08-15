"use client";

import { Download, ImageIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { GenerateImageFormValues } from "@/actions/generated-images/_schemas";
import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import { Button } from "@/components/common/button";
import { GenerateImageForm } from "@/components/generated-images/generate-image-form";
import { GeneratedImageJobRail } from "@/components/generated-images/generated-image-job-rail";
import { GeneratedImageLightbox } from "@/components/generated-images/generated-image-lightbox";
import {
  type GeneratedImageJob,
  useGeneratedImageJobs,
} from "@/components/generated-images/use-generated-image-jobs";
import {
  type GenerateImageRequest,
  MAX_CONCURRENT_IMAGE_GENERATIONS,
} from "@/lib/generated-image-generation-contract";
import {
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
} from "@/lib/generated-images";
import { cn } from "@/lib/util";

type GenerateImageWorkspaceProps = {
  defaultValues: GenerateImageFormValues;
  /** The enhanced description the prefilled image was generated from, if any. */
  initialEnhancedPrompt: string | null;
  initialImage: GeneratedImageListItem | null;
};

export function GenerateImageWorkspace({
  defaultValues,
  initialEnhancedPrompt,
  initialImage,
}: GenerateImageWorkspaceProps) {
  const [stagedJobId, setStagedJobId] = useState<string | null>(null);
  // Tracked by id rather than index: the session list grows while the lightbox
  // is open, and an index pointer would slide onto a different image.
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null);
  // Keyed by job id, not a bare string: two identical messages in a row would
  // otherwise be the same state and never re-announce.
  const [announcement, setAnnouncement] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);

  const handleJobSettled = useCallback((job: GeneratedImageJob) => {
    if (job.status === "failed") {
      setAnnouncement({
        key: job.id,
        message: `Generation failed. ${job.errorMessage ?? ""}`.trim(),
      });
      toast.error(job.errorMessage ?? "The image could not be generated.", {
        id: `image-job-${job.id}`,
      });
      return;
    }

    setAnnouncement({ key: job.id, message: "Generation complete." });
    // Deduped: three near-simultaneous completions should not stack three
    // toasts when the rail already badges each one.
    toast.success("Image generated.", { id: "image-generated" });

    // Nothing staged means nothing to disturb, so the first result takes the
    // stage rather than leaving it blank next to a finished thumbnail.
    setStagedJobId((current) => current ?? job.id);
  }, []);

  const {
    activeCount,
    dismissJob,
    isAtConcurrencyLimit,
    jobs,
    markJobSeen,
    startJob,
  } = useGeneratedImageJobs({
    // The seed job carries the enhancement too, so retrying the prefilled image
    // reproduces it rather than regenerating from the bare description.
    defaultValues: initialEnhancedPrompt
      ? { ...defaultValues, enhancedPrompt: initialEnhancedPrompt }
      : defaultValues,
    initialImage,
    onJobSettled: handleJobSettled,
  });

  const seedJobId = jobs[0]?.id ?? null;
  const effectiveStagedJobId =
    stagedJobId && jobs.some((job) => job.id === stagedJobId)
      ? stagedJobId
      : (seedJobId ?? null);
  const stagedJob = jobs.find((job) => job.id === effectiveStagedJobId) ?? null;
  const stagedImage = stagedJob?.status === "complete" ? stagedJob.image : null;
  const sessionImages = jobs
    .map((job) => job.image)
    .filter((image): image is GeneratedImageListItem => Boolean(image));
  const lightboxIndex = lightboxImageId
    ? sessionImages.findIndex((image) => image.id === lightboxImageId)
    : -1;
  const isRailVisible = jobs.length > 1;

  function selectJob(jobId: string) {
    setStagedJobId(jobId);
    markJobSeen(jobId);
  }

  function retryJob(values: GenerateImageRequest) {
    if (!startJob(values)) {
      toast.error(
        `Up to ${MAX_CONCURRENT_IMAGE_GENERATIONS} generations can run at once.`,
      );
    }
  }

  function openLightbox(trigger: HTMLElement | null) {
    if (!stagedImage) {
      return;
    }

    lightboxTriggerRef.current = trigger;
    setLightboxImageId(stagedImage.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-gutter py-4 lg:flex-row">
      <GenerateImageForm
        activeCount={activeCount}
        defaultValues={defaultValues}
        initialEnhancedPrompt={initialEnhancedPrompt}
        isAtConcurrencyLimit={isAtConcurrencyLimit}
        onGenerate={startJob}
      />

      <section className="flex min-h-0 min-w-0 flex-1 flex-row rounded-lg border border-border/80 bg-card/45">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {stagedImage ? (
            <span className="pointer-events-none absolute top-3 right-3 z-10 truncate rounded-md border border-border/80 bg-background/80 px-2 py-1 text-caption text-muted-foreground backdrop-blur">
              {stagedImage.model} · {stagedImage.aspectRatio} ·{" "}
              {stagedImage.imageSize}
            </span>
          ) : null}

          {stagedImage ? (
            <Button
              aria-label="Download image"
              asChild
              className="absolute right-4 bottom-4 z-20 size-9 rounded-full shadow-md"
              size="icon"
              tooltip="Download image"
              tooltipSide="left"
            >
              <a
                download={getGeneratedImageDownloadFilename(stagedImage)}
                href={getGeneratedImageDownloadUrl(stagedImage.contentUrl)}
              >
                <Download aria-hidden="true" className="size-4" />
              </a>
            </Button>
          ) : null}

          <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
            {stagedImage ? (
              <button
                aria-label="Open generated image"
                className={cn(
                  "relative block h-full w-full cursor-zoom-in overflow-hidden rounded-md outline-none transition-[background-color,box-shadow]",
                  "hover:bg-background/45 focus-visible:ring-[3px] focus-visible:ring-ring/35",
                )}
                onClick={() => openLightbox(previewButtonRef.current)}
                ref={previewButtonRef}
                type="button"
              >
                <Image
                  alt={stagedImage.originalPrompt ?? stagedImage.prompt}
                  className="object-contain"
                  fill
                  sizes={
                    isRailVisible
                      ? "(min-width: 1024px) calc(100vw - 27rem), 100vw"
                      : "(min-width: 1024px) calc(100vw - 22rem), 100vw"
                  }
                  src={stagedImage.contentUrl}
                  unoptimized
                />
              </button>
            ) : stagedJob?.status === "failed" ? (
              <div className="grid max-w-sm gap-4 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-destructive/40 bg-destructive/10 text-destructive">
                  <TriangleAlert aria-hidden="true" className="size-5" />
                </div>
                <p className="text-body text-muted-foreground">
                  {stagedJob.errorMessage ??
                    "The image could not be generated."}
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    onClick={() => retryJob(stagedJob.values)}
                    size="sm"
                    variant="outline"
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : activeCount > 0 ? (
              <div
                className="flex flex-col items-center justify-center gap-3 text-center text-muted-foreground"
                aria-hidden="true"
              >
                <LoaderCircle className="size-7 animate-spin text-primary" />
                <p className="text-body">Generating image...</p>
              </div>
            ) : (
              <div className="grid max-w-sm gap-4 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border/80 bg-muted/70 text-muted-foreground">
                  <ImageIcon aria-hidden="true" className="size-5" />
                </div>
                <p className="text-body text-muted-foreground">
                  Generated images appear here and are saved to the local
                  gallery.
                </p>
              </div>
            )}
          </div>
        </div>

        <GeneratedImageJobRail
          jobs={jobs}
          onDismiss={dismissJob}
          onSelect={selectJob}
          stageFallbackRef={previewButtonRef}
          stagedJobId={effectiveStagedJobId}
        />
      </section>

      {/*
        The live region stays mounted and the message is a keyed child, so each
        settle inserts a fresh node and is announced even when the text repeats.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement ? (
          <span key={announcement.key}>{announcement.message}</span>
        ) : null}
      </p>

      {lightboxIndex >= 0 ? (
        <GeneratedImageLightbox
          images={sessionImages}
          index={lightboxIndex}
          onClose={() => setLightboxImageId(null)}
          onIndexChange={(next) => {
            const nextImage = sessionImages[next];

            if (!nextImage) {
              return;
            }

            setLightboxImageId(nextImage.id);

            const nextJob = jobs.find((job) => job.image?.id === nextImage.id);

            if (nextJob) {
              selectJob(nextJob.id);
            }
          }}
          restoreFocusRef={lightboxTriggerRef}
          showUseSettings={false}
        />
      ) : null}
    </div>
  );
}
