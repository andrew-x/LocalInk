"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Download,
  Info,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
} from "@/components/common/dialog";
import {
  isLightboxControlTarget,
  useGeneratedImageLightboxViewport,
} from "@/components/generated-images/use-generated-image-lightbox-viewport";
import day from "@/lib/dayjs";
import {
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
} from "@/lib/generated-images";
import { cn } from "@/lib/util";

const SLIDESHOW_INTERVAL_MS = 6000;

const CHROME_BUTTON_CLASS_NAME =
  "border-white/15 bg-white/10 text-white hover:bg-white/15";

type GeneratedImageLightboxProps = {
  /** Enables the autoplay timer and the play/pause control (slideshow mode). */
  autoPlay?: boolean;
  images: GeneratedImageListItem[];
  index: number;
  onClose: () => void;
  /** Required for prev/next; omit for a single-image view. */
  onIndexChange?: (index: number) => void;
  /** Focused after close, so keyboard users return to whatever opened this. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  /** Hidden in the generator, where it would just reload the current page. */
  showUseSettings?: boolean;
};

export function GeneratedImageLightbox({
  autoPlay = false,
  images,
  index,
  onClose,
  onIndexChange,
  restoreFocusRef,
  showUseSettings = true,
}: GeneratedImageLightboxProps) {
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isInfoVisible, setIsInfoVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const currentImage = images[index];
  const hasMultipleImages = images.length > 1 && Boolean(onIndexChange);
  const {
    canZoomIn,
    canZoomOut,
    handleDoubleClick,
    handlePointerDown,
    handlePointerMove,
    handleWheel,
    isDragging,
    pan,
    resetZoom,
    stageRef,
    stopDragging,
    zoom,
    zoomIn,
    zoomOut,
  } = useGeneratedImageLightboxViewport();
  const currentImageId = currentImage?.id;

  useEffect(() => {
    if (currentImageId) {
      resetZoom();
    }
  }, [currentImageId, resetZoom]);

  useEffect(() => {
    if (!autoPlay || isPaused || !hasMultipleImages) {
      return;
    }

    const timer = window.setTimeout(() => {
      onIndexChange?.((index + 1) % images.length);
    }, SLIDESHOW_INTERVAL_MS);

    return () => window.clearTimeout(timer);
  }, [
    autoPlay,
    hasMultipleImages,
    images.length,
    index,
    isPaused,
    onIndexChange,
  ]);

  // Escape is intentionally not handled here — Radix owns it, and only for the
  // topmost layer, so a stacked confirm dialog closes alone.
  function handleStageKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      autoPlay &&
      (event.key === " " || event.code === "Space") &&
      !isLightboxControlTarget(event.target)
    ) {
      event.preventDefault();
      setIsPaused((paused) => !paused);
      return;
    }

    if (!hasMultipleImages) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPreviousImage();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNextImage();
    }
  }

  function showPreviousImage() {
    if (hasMultipleImages) {
      onIndexChange?.((index - 1 + images.length) % images.length);
    }
  }

  function showNextImage() {
    if (hasMultipleImages) {
      onIndexChange?.((index + 1) % images.length);
    }
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLElement>) {
    pointerStartRef.current = isLightboxControlTarget(event.target)
      ? null
      : { x: event.clientX, y: event.clientY };

    handlePointerDown(event);
  }

  function handleStagePointerCancel(event: ReactPointerEvent<HTMLElement>) {
    pointerStartRef.current = null;
    stopDragging(event);
  }

  function handleStageClick(event: ReactMouseEvent<HTMLElement>) {
    const pointerStart = pointerStartRef.current;

    pointerStartRef.current = null;

    if (
      !currentImage ||
      event.button !== 0 ||
      (pointerStart &&
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 4) ||
      isLightboxControlTarget(event.target) ||
      isPointInsideVisibleImage(event, currentImage, pan, zoom)
    ) {
      return;
    }

    onClose();
  }

  if (!currentImage) {
    return null;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPortal>
        {/* Radix puts the scroll lock on the Overlay, not the Content, so it
            stays mounted even though the opaque Content covers it. */}
        <DialogOverlay className="bg-black backdrop-blur-none" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 overflow-hidden bg-black text-white outline-none"
          onCloseAutoFocus={(event) => {
            if (!restoreFocusRef?.current) {
              return;
            }

            event.preventDefault();
            restoreFocusRef.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (!isInfoVisible) {
              return;
            }

            event.preventDefault();
            setIsInfoVisible(false);
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            stageRef.current?.focus();
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            {autoPlay ? "Image slideshow" : "Image lightbox"}
          </DialogPrimitive.Title>

          <section
            aria-label={autoPlay ? "Slideshow image" : "Lightbox image"}
            className={cn(
              "relative h-full touch-none overflow-hidden outline-none select-none",
              zoom === 1 ? "cursor-zoom-in" : "cursor-grab",
              isDragging && "cursor-grabbing",
            )}
            onClick={handleStageClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleStageKeyDown}
            onPointerCancel={handleStagePointerCancel}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onWheel={handleWheel}
            ref={stageRef}
            tabIndex={-1}
          >
            <div
              className="absolute inset-0 transition-transform duration-200 ease-out will-change-transform"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
            >
              <Image
                alt={currentImage.prompt}
                className="pointer-events-none object-contain p-4 sm:p-8"
                data-lightbox-image
                draggable={false}
                fill
                key={currentImage.id}
                sizes="100vw"
                src={currentImage.contentUrl}
                unoptimized
              />
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-black/90 via-black/55 to-transparent">
              <div
                className="pointer-events-auto grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-page py-4"
                data-lightbox-control
              >
                <Button
                  aria-label="Close"
                  className={cn("size-9", CHROME_BUTTON_CLASS_NAME)}
                  onClick={onClose}
                  size="icon"
                  tooltip="Close"
                  type="button"
                  variant="outline"
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>

                <div aria-live="polite" className="min-w-0 text-center">
                  <p className="truncate text-label text-white/90">
                    {currentImage.model}
                  </p>
                  <p className="truncate text-caption text-white/55">
                    {autoPlay ? `${isPaused ? "Paused" : "Playing"} · ` : ""}
                    {hasMultipleImages
                      ? `${index + 1} / ${images.length} · `
                      : ""}
                    {formatDimensions(currentImage)} · {currentImage.imageSize}
                  </p>
                </div>

                <div className="flex items-center gap-1 sm:gap-2">
                  {autoPlay ? (
                    <Button
                      aria-label={
                        isPaused ? "Resume slideshow" : "Pause slideshow"
                      }
                      className={cn("size-9", CHROME_BUTTON_CLASS_NAME)}
                      disabled={!hasMultipleImages}
                      onClick={() => setIsPaused((paused) => !paused)}
                      size="icon"
                      tooltip={
                        isPaused ? "Resume slideshow" : "Pause slideshow"
                      }
                      type="button"
                      variant="outline"
                    >
                      {isPaused ? (
                        <Play aria-hidden="true" className="size-4" />
                      ) : (
                        <Pause aria-hidden="true" className="size-4" />
                      )}
                    </Button>
                  ) : null}

                  <Button
                    aria-label="Download image"
                    asChild
                    className={cn("size-9", CHROME_BUTTON_CLASS_NAME)}
                    size="icon"
                    tooltip="Download image"
                    variant="outline"
                  >
                    <a
                      download={getGeneratedImageDownloadFilename(currentImage)}
                      href={getGeneratedImageDownloadUrl(
                        currentImage.contentUrl,
                      )}
                    >
                      <Download aria-hidden="true" className="size-4" />
                    </a>
                  </Button>

                  <Button
                    aria-label={isInfoVisible ? "Hide details" : "Show details"}
                    className={cn("size-9", CHROME_BUTTON_CLASS_NAME)}
                    onClick={() => setIsInfoVisible((visible) => !visible)}
                    size="icon"
                    tooltip={isInfoVisible ? "Hide details" : "Show details"}
                    type="button"
                    variant="outline"
                  >
                    <Info aria-hidden="true" className="size-4" />
                  </Button>

                  {showUseSettings ? (
                    <Button
                      aria-label="Use settings"
                      asChild
                      className={cn("size-9", CHROME_BUTTON_CLASS_NAME)}
                      size="icon"
                      tooltip="Use settings"
                      variant="outline"
                    >
                      <Link href={`/images/generate?source=${currentImage.id}`}>
                        <CopyPlus aria-hidden="true" className="size-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {hasMultipleImages ? (
              <>
                <div
                  className="pointer-events-auto absolute top-1/2 left-2 z-10 -translate-y-1/2 sm:left-4"
                  data-lightbox-control
                >
                  <Button
                    aria-label="Previous image"
                    className={cn(
                      "size-10 rounded-full",
                      CHROME_BUTTON_CLASS_NAME,
                    )}
                    onClick={showPreviousImage}
                    size="icon"
                    tooltip="Previous image"
                    tooltipSide="right"
                    type="button"
                    variant="outline"
                  >
                    <ChevronLeft aria-hidden="true" className="size-5" />
                  </Button>
                </div>

                <div
                  className="pointer-events-auto absolute top-1/2 right-2 z-10 -translate-y-1/2 sm:right-4"
                  data-lightbox-control
                >
                  <Button
                    aria-label="Next image"
                    className={cn(
                      "size-10 rounded-full",
                      CHROME_BUTTON_CLASS_NAME,
                    )}
                    onClick={showNextImage}
                    size="icon"
                    tooltip="Next image"
                    tooltipSide="left"
                    type="button"
                    variant="outline"
                  >
                    <ChevronRight aria-hidden="true" className="size-5" />
                  </Button>
                </div>
              </>
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-black/90 via-black/55 to-transparent">
              <div
                className="pointer-events-auto flex flex-col items-center gap-3 px-page pt-16 pb-4"
                data-lightbox-control
              >
                <div className="flex items-center gap-1 rounded-md border border-white/15 bg-black/55 p-1 shadow-sm backdrop-blur">
                  <Button
                    aria-label="Zoom out"
                    className="size-8 text-white hover:bg-white/10"
                    disabled={!canZoomOut}
                    onClick={zoomOut}
                    size="icon"
                    tooltip="Zoom out"
                    type="button"
                    variant="ghost"
                  >
                    <Minus aria-hidden="true" className="size-4" />
                  </Button>
                  <span className="min-w-12 px-1 text-center text-caption text-white/65">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    aria-label="Zoom in"
                    className="size-8 text-white hover:bg-white/10"
                    disabled={!canZoomIn}
                    onClick={zoomIn}
                    size="icon"
                    tooltip="Zoom in"
                    type="button"
                    variant="ghost"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    aria-label="Reset zoom"
                    className="size-8 text-white hover:bg-white/10"
                    disabled={!canZoomOut}
                    onClick={resetZoom}
                    size="icon"
                    tooltip="Reset zoom"
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            {isInfoVisible ? (
              <aside
                aria-label="Image generation details"
                className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-white/15 border-l bg-black/88 text-white shadow-2xl backdrop-blur-xl sm:w-[26rem]"
                data-lightbox-control
              >
                <div className="flex min-h-16 items-center justify-between gap-3 border-white/10 border-b px-panel">
                  <div className="min-w-0">
                    <h2 className="truncate text-heading">
                      Generation details
                    </h2>
                    <p className="truncate text-caption text-white/55">
                      {formatDimensions(currentImage)} ·{" "}
                      {currentImage.imageSize}
                    </p>
                  </div>
                  <Button
                    aria-label="Hide details"
                    className="size-8 text-white hover:bg-white/10"
                    onClick={() => setIsInfoVisible(false)}
                    size="icon"
                    tooltip="Hide details"
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-panel py-4">
                  <div className="grid gap-5">
                    <DetailSection label="Prompt" value={currentImage.prompt} />
                    <DetailSection
                      label="Style prompt"
                      value={currentImage.stylePrompt || "None"}
                    />

                    <dl className="grid grid-cols-2 gap-3">
                      <DetailItem
                        label="Model"
                        value={currentImage.model}
                        wide
                      />
                      <DetailItem
                        label="Style"
                        value={formatStylePreset(currentImage.stylePreset)}
                      />
                      <DetailItem
                        label="Aspect"
                        value={currentImage.aspectRatio}
                      />
                      <DetailItem
                        label="Image size"
                        value={currentImage.imageSize}
                      />
                      <DetailItem
                        label="Dimensions"
                        value={formatDimensions(currentImage)}
                      />
                      <DetailItem
                        label="Format"
                        value={currentImage.mimeType}
                      />
                      <DetailItem
                        label="Created"
                        value={formatCreatedAt(currentImage.createdAt)}
                        wide
                      />
                    </dl>
                  </div>
                </div>
              </aside>
            ) : null}
          </section>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function DetailSection({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-caption text-white/45">{label}</p>
      <p className="whitespace-pre-wrap break-words rounded-md border border-white/10 bg-white/5 px-3 py-2 text-body text-white/88">
        {value}
      </p>
    </div>
  );
}

function DetailItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-white/10 bg-white/5 px-3 py-2",
        wide && "col-span-2",
      )}
    >
      <dt className="text-caption text-white/45">{label}</dt>
      <dd className="mt-1 break-words text-label text-white/88">{value}</dd>
    </div>
  );
}

function formatDimensions(image: GeneratedImageListItem) {
  if (!image.width || !image.height) {
    return image.aspectRatio;
  }

  return `${image.width}x${image.height}`;
}

function formatCreatedAt(createdAt: string) {
  const date = day(createdAt);

  if (!date.isValid()) {
    return "recently";
  }

  return date.format("lll");
}

function formatStylePreset(stylePreset: GeneratedImageListItem["stylePreset"]) {
  return stylePreset
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function isPointInsideVisibleImage(
  event: ReactMouseEvent<HTMLElement>,
  image: GeneratedImageListItem,
  pan: { x: number; y: number },
  zoom: number,
) {
  const stage = event.currentTarget;
  const imageElement = stage.querySelector<HTMLElement>(
    "[data-lightbox-image]",
  );
  const imageAspectRatio = getImageAspectRatio(image);

  if (!imageElement || !imageAspectRatio) {
    return true;
  }

  const stageRect = stage.getBoundingClientRect();
  const imageStyles = window.getComputedStyle(imageElement);
  const paddingLeft = parseCssPixels(imageStyles.paddingLeft);
  const paddingRight = parseCssPixels(imageStyles.paddingRight);
  const paddingTop = parseCssPixels(imageStyles.paddingTop);
  const paddingBottom = parseCssPixels(imageStyles.paddingBottom);
  const contentWidth = stageRect.width - paddingLeft - paddingRight;
  const contentHeight = stageRect.height - paddingTop - paddingBottom;

  if (contentWidth <= 0 || contentHeight <= 0) {
    return true;
  }

  const contentAspectRatio = contentWidth / contentHeight;
  const imageWidth =
    contentAspectRatio > imageAspectRatio
      ? contentHeight * imageAspectRatio
      : contentWidth;
  const imageHeight = imageWidth / imageAspectRatio;
  const imageLeft =
    stageRect.left + paddingLeft + (contentWidth - imageWidth) / 2;
  const imageTop =
    stageRect.top + paddingTop + (contentHeight - imageHeight) / 2;
  const imageRight = imageLeft + imageWidth;
  const imageBottom = imageTop + imageHeight;
  const stageCenterX = stageRect.left + stageRect.width / 2;
  const stageCenterY = stageRect.top + stageRect.height / 2;
  const transformedLeft =
    stageCenterX + pan.x + (imageLeft - stageCenterX) * zoom;
  const transformedRight =
    stageCenterX + pan.x + (imageRight - stageCenterX) * zoom;
  const transformedTop =
    stageCenterY + pan.y + (imageTop - stageCenterY) * zoom;
  const transformedBottom =
    stageCenterY + pan.y + (imageBottom - stageCenterY) * zoom;

  return (
    event.clientX >= transformedLeft &&
    event.clientX <= transformedRight &&
    event.clientY >= transformedTop &&
    event.clientY <= transformedBottom
  );
}

function getImageAspectRatio(image: GeneratedImageListItem) {
  if (image.width && image.height) {
    return image.width / image.height;
  }

  const [width, height] = image.aspectRatio.split(":").map(Number);

  if (!width || !height) {
    return null;
  }

  return width / height;
}

function parseCssPixels(value: string) {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
}
