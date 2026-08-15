"use client";

import {
  CalendarClock,
  Check,
  CopyPlus,
  Download,
  Images,
  Info,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import { deleteGeneratedImage } from "@/actions/generated-images/delete-generated-image";
import { deleteGeneratedImages } from "@/actions/generated-images/delete-generated-images";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";
import { GeneratedImageLightbox } from "@/components/generated-images/generated-image-lightbox";
import day from "@/lib/dayjs";
import {
  CUSTOM_GENERATED_IMAGE_STYLE_PRESET,
  GENERATED_IMAGE_STYLE_PRESET_OPTIONS,
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
} from "@/lib/generated-images";
import { cn } from "@/lib/util";

type GeneratedImageGalleryProps = {
  images: GeneratedImageListItem[];
};

export function GeneratedImageGallery({ images }: GeneratedImageGalleryProps) {
  const router = useRouter();
  const [galleryImages, setGalleryImages] = useState(images);
  const [previewImage, setPreviewImage] =
    useState<GeneratedImageListItem | null>(null);
  const [deleteImage, setDeleteImage] = useState<GeneratedImageListItem | null>(
    null,
  );
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);
  const [slideshowImages, setSlideshowImages] = useState<
    GeneratedImageListItem[] | null
  >(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  // Tracked by id rather than index: galleryImages can change underneath the
  // lightbox, and an index pointer would silently slide onto a different
  // image. A removed id resolves to -1, which closes the lightbox.
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null);
  // The tile that opened the lightbox, so focus returns there on close.
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);
  const slideshowButtonRef = useRef<HTMLButtonElement>(null);
  const lightboxIndex = lightboxImageId
    ? galleryImages.findIndex((image) => image.id === lightboxImageId)
    : -1;
  const deleteAction = useAction(deleteGeneratedImage);
  const bulkDeleteAction = useAction(deleteGeneratedImages);
  const isDeleting = deleteAction.isPending;
  const isBulkDeleting = bulkDeleteAction.isPending;
  const selectedImages = galleryImages.filter((image) =>
    selectedImageIds.has(image.id),
  );
  const selectedCount = selectedImages.length;

  function startSlideshow() {
    if (!galleryImages.length) {
      return;
    }

    setSlideshowIndex(0);
    setSlideshowImages(shuffleImages(galleryImages));
  }

  async function handleDelete() {
    if (!deleteImage) {
      return;
    }

    const result = await deleteAction.executeAsync({ id: deleteImage.id });

    if (result.data) {
      setGalleryImages((currentImages) =>
        currentImages.filter((image) => image.id !== result.data?.id),
      );
      setSelectedImageIds((currentIds) => {
        if (!result.data || !currentIds.has(result.data.id)) {
          return currentIds;
        }

        const nextIds = new Set(currentIds);
        nextIds.delete(result.data.id);
        return nextIds;
      });
      setDeleteImage(null);
      toast.success("Image deleted.");
      router.refresh();
      return;
    }

    const message =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : "The image could not be deleted.");

    if (message) {
      toast.error(message);
    }
  }

  function handleSelectionChange(imageId: string, selected: boolean) {
    setSelectedImageIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (selected) {
        nextIds.add(imageId);
      } else {
        nextIds.delete(imageId);
      }

      return nextIds;
    });
  }

  function clearSelection() {
    setSelectedImageIds(new Set());
  }

  function handleDownloadSelectedImages() {
    if (!selectedImages.length) {
      return;
    }

    for (const image of selectedImages) {
      downloadGeneratedImage(image);
    }

    toast.success(
      selectedImages.length === 1
        ? "Download started."
        : `${selectedImages.length} downloads started.`,
    );
  }

  async function handleBulkDelete() {
    const ids = selectedImages.map((image) => image.id);

    if (!ids.length) {
      return;
    }

    const result = await bulkDeleteAction.executeAsync({ ids });

    if (result.data) {
      const deletedIds = new Set(result.data.ids);

      setGalleryImages((currentImages) =>
        currentImages.filter((image) => !deletedIds.has(image.id)),
      );
      clearSelection();
      setIsBulkDeleteDialogOpen(false);
      toast.success(`${formatImageCount(deletedIds.size)} deleted.`);
      router.refresh();
      return;
    }

    const message =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors
        ? undefined
        : "The images could not be deleted.");

    if (message) {
      toast.error(message);
    }
  }

  return (
    <>
      <section
        aria-labelledby="generated-images-heading"
        className="flex min-h-0 flex-1 flex-col py-6"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="generated-images-heading" className="font-serif text-title">
              Image Gallery
            </h1>
            <p className="mt-1 text-body text-muted-foreground">
              {galleryImages.length
                ? formatImageCount(galleryImages.length)
                : "No generated images yet"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={!galleryImages.length}
              onClick={startSlideshow}
              ref={slideshowButtonRef}
              type="button"
              variant="outline"
            >
              <Shuffle aria-hidden="true" />
              Slideshow
            </Button>

            <Button asChild>
              <Link href="/images/generate">
                <CopyPlus aria-hidden="true" />
                Generate
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-7 flex-1">
          {galleryImages.length ? (
            <div className="grid grid-flow-dense auto-rows-fr grid-cols-3 gap-0.5 sm:gap-1 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {galleryImages.map((image, index) => (
                <GeneratedImageCard
                  feature={isFeatureIndex(index)}
                  image={image}
                  key={image.id}
                  onDelete={() => setDeleteImage(image)}
                  onOpen={(trigger) => {
                    lightboxTriggerRef.current = trigger;
                    setLightboxImageId(image.id);
                  }}
                  onPreviewPrompt={() => setPreviewImage(image)}
                  onSelectionChange={(selected) =>
                    handleSelectionChange(image.id, selected)
                  }
                  selectionActive={selectedCount > 0}
                  selected={selectedImageIds.has(image.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-lg border border-border/80 bg-card/45 px-panel py-12 text-center">
              <div className="max-w-md">
                <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border/80 bg-muted/70 text-muted-foreground">
                  <Images aria-hidden="true" className="size-5" />
                </div>
                <h3 className="mt-5 font-serif text-title">No images yet</h3>
                <p className="mt-3 text-body text-muted-foreground">
                  Generated images will appear here after the first successful
                  generation.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <PromptPreviewDialog
        image={previewImage}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null);
          }
        }}
      />

      {selectedCount ? (
        <GeneratedImageBulkSelectionBar
          isDeleting={isBulkDeleting}
          onCancel={clearSelection}
          onDelete={() => setIsBulkDeleteDialogOpen(true)}
          onDownload={handleDownloadSelectedImages}
          selectedCount={selectedCount}
        />
      ) : null}

      <Dialog
        open={Boolean(deleteImage)}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteImage(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader className="p-panel pb-0 pr-12">
            <DialogTitle>Delete image</DialogTitle>
            <DialogDescription>
              This removes the gallery row and the local image file.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-panel pb-panel">
            <DialogClose asChild>
              <Button disabled={isDeleting} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              loading={isDeleting}
              onClick={handleDelete}
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isBulkDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isBulkDeleting) {
            setIsBulkDeleteDialogOpen(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader className="p-panel pb-0 pr-12">
            <DialogTitle>Delete selected images</DialogTitle>
            <DialogDescription>
              This removes {formatImageCount(selectedCount)} from the gallery
              and deletes their local image files.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="px-panel pb-panel">
            <DialogClose asChild>
              <Button disabled={isBulkDeleting} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              loading={isBulkDeleting}
              onClick={handleBulkDelete}
              type="button"
              variant="destructive"
            >
              Delete {selectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lightboxIndex >= 0 ? (
        <GeneratedImageLightbox
          images={galleryImages}
          index={lightboxIndex}
          onClose={() => setLightboxImageId(null)}
          onIndexChange={(nextIndex) =>
            setLightboxImageId(galleryImages[nextIndex]?.id ?? null)
          }
          restoreFocusRef={lightboxTriggerRef}
        />
      ) : null}

      {slideshowImages ? (
        <GeneratedImageLightbox
          autoPlay
          images={slideshowImages}
          index={slideshowIndex}
          onClose={() => setSlideshowImages(null)}
          onIndexChange={setSlideshowIndex}
          restoreFocusRef={slideshowButtonRef}
        />
      ) : null}
    </>
  );
}

function GeneratedImageCard({
  feature,
  image,
  onDelete,
  onOpen,
  onPreviewPrompt,
  onSelectionChange,
  selectionActive,
  selected,
}: {
  feature: boolean;
  image: GeneratedImageListItem;
  onDelete: () => void;
  onOpen: (trigger: HTMLElement) => void;
  onPreviewPrompt: () => void;
  onSelectionChange: (selected: boolean) => void;
  selectionActive: boolean;
  selected: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative aspect-square overflow-hidden bg-card/60",
        "focus-within:z-10 focus-within:ring-2 focus-within:ring-ring",
        feature && "col-span-2 row-span-2",
        selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      )}
    >
      <label
        className={cn(
          "pointer-events-none absolute top-2 left-2 z-20 flex size-5 cursor-pointer items-center justify-center opacity-0 drop-shadow-sm transition-opacity focus-within:ring-[3px] focus-within:ring-ring/35",
          "group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
          selectionActive && "pointer-events-auto opacity-100",
        )}
      >
        <span className="sr-only">Select image</span>
        <input
          checked={selected}
          className="peer sr-only"
          onChange={(event) => onSelectionChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span className="flex size-4 items-center justify-center rounded-[4px] border border-white/75 bg-black/35 text-primary-foreground backdrop-blur-[1px] transition-colors peer-checked:border-primary peer-checked:bg-primary">
          <Check
            aria-hidden="true"
            className={cn(
              "size-3 transition-opacity",
              selected ? "opacity-100" : "opacity-0",
            )}
          />
        </span>
      </label>

      <button
        aria-label="Open generated image"
        className="block h-full w-full cursor-zoom-in bg-background outline-none"
        onClick={(event) => onOpen(event.currentTarget)}
        type="button"
      >
        <Image
          alt={image.originalPrompt ?? image.prompt}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          fill
          sizes={
            feature
              ? "(min-width: 1280px) 33vw, (min-width: 1024px) 40vw, (min-width: 768px) 50vw, 66vw"
              : "(min-width: 1280px) 17vw, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, 33vw"
          }
          src={image.contentUrl}
          unoptimized
        />
      </button>

      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col justify-end bg-linear-to-t from-background/90 via-background/30 to-transparent opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100",
          selected && "opacity-100",
        )}
      >
        <div className="pointer-events-auto flex items-end justify-between gap-2 p-2 sm:p-3">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "line-clamp-2 text-label",
                feature ? "text-body" : "text-caption",
              )}
            >
              {image.originalPrompt ?? image.prompt}
            </p>
            {feature ? (
              <p className="mt-1 flex items-center gap-1 text-caption text-muted-foreground">
                <CalendarClock aria-hidden="true" className="size-3.5" />
                {formatCreatedAt(image.createdAt)}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              aria-label="View prompt"
              className="size-7 bg-background/85"
              onClick={onPreviewPrompt}
              size="icon"
              tooltip="View prompt"
              type="button"
              variant="outline"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </Button>
            <Button
              aria-label="Download image"
              asChild
              className="size-7 bg-background/85"
              size="icon"
              tooltip="Download image"
              variant="outline"
            >
              <a
                download={getGeneratedImageDownloadFilename(image)}
                href={getGeneratedImageDownloadUrl(image.contentUrl)}
              >
                <Download aria-hidden="true" className="size-3.5" />
              </a>
            </Button>
            <Button
              aria-label="Use settings"
              asChild
              className="size-7 bg-background/85"
              size="icon"
              tooltip="Use settings"
              variant="outline"
            >
              <Link href={`/images/generate?source=${image.id}`}>
                <CopyPlus aria-hidden="true" className="size-3.5" />
              </Link>
            </Button>
            <Button
              aria-label="Delete image"
              className="size-7 bg-background/85"
              onClick={onDelete}
              size="icon"
              tooltip="Delete image"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function GeneratedImageBulkSelectionBar({
  isDeleting,
  onCancel,
  onDelete,
  onDownload,
  selectedCount,
}: {
  isDeleting: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onDownload: () => void;
  selectedCount: number;
}) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-page">
      <div className="flex w-full max-w-2xl flex-col gap-2 rounded-lg border border-border/80 bg-popover/95 p-2 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p
          aria-live="polite"
          className="min-w-0 px-2 text-center text-label text-popover-foreground sm:text-left"
        >
          {formatImageCount(selectedCount)} selected
        </p>
        <div className="grid gap-2 sm:flex sm:items-center">
          <Button
            className="w-full sm:w-auto"
            disabled={isDeleting}
            onClick={onDownload}
            size="sm"
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" />
            Download
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={isDeleting}
            onClick={onDelete}
            size="sm"
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
          <Button
            className="w-full sm:w-auto"
            disabled={isDeleting}
            onClick={onCancel}
            size="sm"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function PromptPreviewDialog({
  image,
  onOpenChange,
}: {
  image: GeneratedImageListItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const stylePresetName =
    image && getStylePresetName(image.stylePreset, image.stylePrompt);

  return (
    <Dialog open={Boolean(image)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] overflow-hidden sm:max-w-3xl">
        <DialogHeader className="border-border/80 border-b p-panel pr-12">
          <DialogTitle>Prompt Preview</DialogTitle>
          <DialogDescription>
            {image
              ? `${image.model} · ${formatDimensions(image)} · ${stylePresetName}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {image ? (
          <div className="grid gap-4 overflow-y-auto px-panel pb-panel">
            <PreviewField
              label="Image description"
              value={image.originalPrompt ?? image.prompt}
            />
            {image.originalPrompt ? (
              <PreviewField label="Enhanced prompt" value={image.prompt} />
            ) : null}
            <PreviewField label="Style" value={stylePresetName ?? ""} />
            <PreviewField label="Style prompt" value={image.stylePrompt} />
            <PreviewField
              label="Output"
              value={`${image.aspectRatio} · ${image.imageSize} · ${image.mimeType}`}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap rounded-md border border-border/80 bg-background/60 px-3 py-2 text-body">
        {value || "None"}
      </p>
    </div>
  );
}

function getStylePresetName(
  stylePreset: GeneratedImageListItem["stylePreset"],
  stylePrompt: string,
) {
  if (stylePreset === CUSTOM_GENERATED_IMAGE_STYLE_PRESET) {
    return "Custom";
  }

  return (
    GENERATED_IMAGE_STYLE_PRESET_OPTIONS.find(
      (preset) => preset.id === stylePreset,
    )?.name ?? (stylePrompt ? "Custom" : "None")
  );
}

function isFeatureIndex(index: number) {
  return index % 7 === 3;
}

function shuffleImages(images: GeneratedImageListItem[]) {
  const shuffledImages = [...images];

  for (let index = shuffledImages.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffledImages[index], shuffledImages[swapIndex]] = [
      shuffledImages[swapIndex],
      shuffledImages[index],
    ];
  }

  return shuffledImages;
}

function formatCreatedAt(createdAt: string) {
  const date = day(createdAt);

  if (!date.isValid()) {
    return "recently";
  }

  return date.format("lll");
}

function formatDimensions(image: GeneratedImageListItem) {
  if (!image.width || !image.height) {
    return `${image.aspectRatio} · ${image.imageSize}`;
  }

  return `${image.width}x${image.height}`;
}

function formatImageCount(count: number) {
  return `${count} ${count === 1 ? "image" : "images"}`;
}

function downloadGeneratedImage(image: GeneratedImageListItem) {
  const link = document.createElement("a");

  link.download = getGeneratedImageDownloadFilename(image);
  link.href = getGeneratedImageDownloadUrl(image.contentUrl);
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}
