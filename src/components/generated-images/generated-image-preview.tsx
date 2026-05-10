"use client";

import {
  ArrowLeft,
  CopyPlus,
  Download,
  Info,
  Minus,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type { GeneratedImageDetail } from "@/actions/generated-images/_types";
import { Button } from "@/components/common/button";
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

type GeneratedImagePreviewProps = {
  backHref?: string;
  backLabel?: string;
  image: GeneratedImageDetail;
};

export function GeneratedImagePreview({
  backHref = "/images",
  backLabel = "Gallery",
  image,
}: GeneratedImagePreviewProps) {
  const router = useRouter();
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const [isInfoVisible, setIsInfoVisible] = useState(false);
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        router.push(backHref);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [backHref, router]);

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
      event.button !== 0 ||
      (pointerStart &&
        Math.hypot(
          event.clientX - pointerStart.x,
          event.clientY - pointerStart.y,
        ) > 4) ||
      isLightboxControlTarget(event.target) ||
      isPointInsideVisibleImage(event, image, pan, zoom)
    ) {
      return;
    }

    router.push(backHref);
  }

  function handleStageKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") {
      return;
    }

    router.push(backHref);
  }

  return (
    <main className="h-dvh overflow-hidden bg-black text-white">
      <section
        aria-label="Image lightbox"
        className={cn(
          "relative h-dvh touch-none overflow-hidden select-none",
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
      >
        <div
          className="absolute inset-0 transition-transform duration-200 ease-out will-change-transform"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
        >
          <Image
            alt={image.prompt}
            className="pointer-events-none object-contain p-4 sm:p-8"
            draggable={false}
            fill
            priority
            data-lightbox-image
            sizes="100vw"
            src={image.contentUrl}
            unoptimized
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-black/90 via-black/55 to-transparent">
          <div
            className="pointer-events-auto flex items-center justify-between gap-3 px-page py-4"
            data-lightbox-control
          >
            <Button
              asChild
              className="border-white/15 bg-white/10 text-white hover:bg-white/15"
              variant="outline"
            >
              <Link href={backHref}>
                <ArrowLeft aria-hidden="true" />
                {backLabel}
              </Link>
            </Button>

            <div className="hidden min-w-0 text-center sm:block">
              <p className="truncate text-label text-white/90">{image.model}</p>
              <p className="truncate text-caption text-white/55">
                {formatDimensions(image)} · {image.imageSize}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                aria-label="Download image"
                asChild
                className="size-9 border-white/15 bg-white/10 text-white hover:bg-white/15"
                size="icon"
                tooltip="Download image"
                variant="outline"
              >
                <a
                  download={getGeneratedImageDownloadFilename(image)}
                  href={getGeneratedImageDownloadUrl(image.contentUrl)}
                >
                  <Download aria-hidden="true" className="size-4" />
                </a>
              </Button>

              <Button
                aria-label={isInfoVisible ? "Hide details" : "Show details"}
                className="size-9 border-white/15 bg-white/10 text-white hover:bg-white/15"
                onClick={() => setIsInfoVisible((visible) => !visible)}
                size="icon"
                tooltip={isInfoVisible ? "Hide details" : "Show details"}
                type="button"
                variant="outline"
              >
                <Info aria-hidden="true" className="size-4" />
              </Button>

              <Button
                asChild
                className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                variant="outline"
              >
                <Link href={`/images/generate?source=${image.id}`}>
                  <CopyPlus aria-hidden="true" />
                  Use settings
                </Link>
              </Button>
            </div>
          </div>
        </div>

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
                <h2 className="truncate text-heading">Generation details</h2>
                <p className="truncate text-caption text-white/55">
                  {formatDimensions(image)} · {image.imageSize}
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
                <DetailSection label="Prompt" value={image.prompt} />
                <DetailSection
                  label="Style prompt"
                  value={image.stylePrompt || "None"}
                />

                <dl className="grid grid-cols-2 gap-3">
                  <DetailItem label="Model" value={image.model} wide />
                  <DetailItem
                    label="Style"
                    value={formatStylePreset(image.stylePreset)}
                  />
                  <DetailItem label="Aspect" value={image.aspectRatio} />
                  <DetailItem label="Image size" value={image.imageSize} />
                  <DetailItem
                    label="Dimensions"
                    value={formatDimensions(image)}
                  />
                  <DetailItem label="Format" value={image.mimeType} />
                  <DetailItem
                    label="Created"
                    value={formatCreatedAt(image.createdAt)}
                    wide
                  />
                </dl>
              </div>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
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

function formatDimensions(image: GeneratedImageDetail) {
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

function formatStylePreset(stylePreset: GeneratedImageDetail["stylePreset"]) {
  return stylePreset
    .split("-")
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function isPointInsideVisibleImage(
  event: ReactMouseEvent<HTMLElement>,
  image: GeneratedImageDetail,
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

function getImageAspectRatio(image: GeneratedImageDetail) {
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
