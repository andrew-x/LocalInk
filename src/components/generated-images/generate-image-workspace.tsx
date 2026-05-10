"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import {
  ChevronDown,
  Download,
  ImageIcon,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";

import {
  type GenerateImageFormValues,
  generateImageFormSchema,
} from "@/actions/generated-images/_schemas";
import type { GeneratedImageListItem } from "@/actions/generated-images/_types";
import { enhanceImagePrompt } from "@/actions/generated-images/enhance-image-prompt";
import { generateImage } from "@/actions/generated-images/generate-image";
import { Button } from "@/components/common/button";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import {
  GENERATED_IMAGE_ASPECT_RATIOS,
  GENERATED_IMAGE_MODELS,
  GENERATED_IMAGE_SIZES,
  GENERATED_IMAGE_STYLE_PRESET_OPTIONS,
  getGeneratedImageDownloadFilename,
  getGeneratedImageDownloadUrl,
  getGeneratedImageStylePresetPrompt,
} from "@/lib/generated-images";
import { formResolver } from "@/lib/schemas/resolve";
import { cn } from "@/lib/util";

type GenerateImageWorkspaceProps = {
  defaultValues: GenerateImageFormValues;
  initialImage: GeneratedImageListItem | null;
};

export function GenerateImageWorkspace({
  defaultValues,
  initialImage,
}: GenerateImageWorkspaceProps) {
  const [generatedImage, setGeneratedImage] =
    useState<GeneratedImageListItem | null>(initialImage);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMoreRatios, setShowMoreRatios] = useState(
    () => !COMMON_ASPECT_RATIOS.includes(defaultValues.aspectRatio),
  );
  const { form, action: generateAction } = useHookFormAction(
    generateImage,
    formResolver(generateImageFormSchema),
    {
      formProps: {
        defaultValues,
      },
    },
  );
  const enhancePromptAction = useAction(enhanceImagePrompt);
  const imagePrompt = form.watch("prompt");
  const stylePreset = form.watch("stylePreset");
  const stylePrompt = form.watch("stylePrompt");
  const isGenerating = generateAction.isPending;
  const isEnhancingPrompt = enhancePromptAction.isPending;
  const canEnhancePrompt = Boolean(imagePrompt?.trim());
  const rootError = form.formState.errors.root?.message;

  useEffect(() => {
    if (!stylePreset || stylePreset === "custom") {
      return;
    }

    if (stylePrompt !== getGeneratedImageStylePresetPrompt(stylePreset)) {
      form.setValue("stylePreset", "custom", {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }, [form, stylePreset, stylePrompt]);

  async function handleGenerate(values: GenerateImageFormValues) {
    if (isGenerating) {
      return;
    }

    form.clearErrors("root");

    const result = await generateAction.executeAsync(values);

    if (result.data) {
      setGeneratedImage(result.data);
      generateAction.reset();
      toast.success("Image generated.");
      return;
    }

    const message =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors
        ? undefined
        : "The image could not be generated.");

    if (message) {
      form.setError("root", { message });
      toast.error(message);
    }
  }

  async function handleEnhancePrompt() {
    if (isGenerating || isEnhancingPrompt || !canEnhancePrompt) {
      return;
    }

    form.clearErrors("root");
    form.clearErrors("prompt");

    const result = await enhancePromptAction.executeAsync(form.getValues());

    if (result.data) {
      form.setValue("prompt", result.data.prompt, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
      toast.success("Image description enhanced.");
      return;
    }

    const promptMessage = result.validationErrors?.fieldErrors?.prompt?.[0];
    const stylePromptMessage =
      result.validationErrors?.fieldErrors?.stylePrompt?.[0];
    const message =
      promptMessage ??
      stylePromptMessage ??
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors
        ? undefined
        : "The image description could not be enhanced.");

    if (!message) {
      return;
    }

    if (promptMessage) {
      form.setError("prompt", { message: promptMessage });
    } else if (stylePromptMessage) {
      setShowAdvanced(true);
      form.setError("stylePrompt", { message: stylePromptMessage });
    } else {
      form.setError("root", { message });
    }

    toast.error(message);
  }

  function handleGenerationShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (!isGenerationShortcut(event) || isGenerating || isEnhancingPrompt) {
      return;
    }

    event.preventDefault();
    event.currentTarget.requestSubmit();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-gutter py-4 lg:flex-row">
      <form
        autoComplete="off"
        className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-lg border border-border/80 bg-card/70 lg:w-[21rem] lg:shrink-0"
        onKeyDown={handleGenerationShortcut}
        onSubmit={form.handleSubmit(handleGenerate)}
      >
        <div className="border-border/80 border-b px-panel py-3">
          <h1 className="font-serif text-title">Generate Images</h1>
        </div>

        <div className="grid min-h-0 content-start gap-4 overflow-y-auto p-panel">
          <Controller
            control={form.control}
            name="prompt"
            render={({ field, fieldState }) => (
              <FieldShell
                error={fieldState.error?.message}
                label="Image description"
                action={
                  <Button
                    aria-label="Enhance image description"
                    className="size-6 p-0 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    disabled={
                      isGenerating || isEnhancingPrompt || !canEnhancePrompt
                    }
                    leftSection={<Sparkles aria-hidden="true" />}
                    loading={isEnhancingPrompt}
                    onClick={handleEnhancePrompt}
                    size="sm"
                    tooltip="Enhance with DeepSeek V4"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <Textarea
                  {...field}
                  aria-invalid={fieldState.invalid || undefined}
                  className="min-h-64 resize-none text-label"
                  maxLength={4000}
                  placeholder="A rain-slick alley outside a tiny midnight print shop..."
                  rows={12}
                />
              </FieldShell>
            )}
          />

          <Controller
            control={form.control}
            name="aspectRatio"
            render={({ field, fieldState }) => (
              <FieldShell
                error={fieldState.error?.message}
                label="Aspect ratio"
              >
                <div className="grid gap-1">
                  <div className="grid grid-cols-4 gap-1">
                    {COMMON_ASPECT_RATIOS.map((ratio) => (
                      <button
                        aria-pressed={field.value === ratio}
                        className={cn(toggleButtonClassName)}
                        key={ratio}
                        onClick={() => field.onChange(ratio)}
                        type="button"
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                  {showMoreRatios ? (
                    <div className="grid grid-cols-4 gap-1">
                      {OTHER_ASPECT_RATIOS.map((ratio) => (
                        <button
                          aria-pressed={field.value === ratio}
                          className={cn(toggleButtonClassName)}
                          key={ratio}
                          onClick={() => field.onChange(ratio)}
                          type="button"
                        >
                          {ratio}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    aria-expanded={showMoreRatios}
                    className="flex items-center gap-1 self-start rounded-md text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
                    onClick={() => setShowMoreRatios((current) => !current)}
                    type="button"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 transition-transform",
                        showMoreRatios && "rotate-180",
                      )}
                    />
                    {showMoreRatios ? "Fewer ratios" : "More ratios"}
                  </button>
                </div>
              </FieldShell>
            )}
          />

          <Controller
            control={form.control}
            name="model"
            render={({ field, fieldState }) => (
              <FieldShell error={fieldState.error?.message} label="Model">
                <select
                  {...field}
                  aria-invalid={fieldState.invalid || undefined}
                  className={selectClassName}
                >
                  {GENERATED_IMAGE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </FieldShell>
            )}
          />

          <Controller
            control={form.control}
            name="stylePreset"
            render={({ field, fieldState }) => (
              <FieldShell error={fieldState.error?.message} label="Style">
                <select
                  {...field}
                  aria-invalid={fieldState.invalid || undefined}
                  className={selectClassName}
                  onChange={(event) => {
                    const nextPreset = event.target
                      .value as GenerateImageFormValues["stylePreset"];

                    field.onChange(nextPreset);

                    if (nextPreset !== "custom") {
                      form.setValue(
                        "stylePrompt",
                        getGeneratedImageStylePresetPrompt(nextPreset),
                        {
                          shouldDirty: true,
                          shouldValidate: true,
                        },
                      );
                    }
                  }}
                >
                  {GENERATED_IMAGE_STYLE_PRESET_OPTIONS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </FieldShell>
            )}
          />

          <div className="grid gap-2">
            <button
              aria-expanded={showAdvanced}
              className="flex items-center justify-between rounded-md text-label-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35"
              onClick={() => setShowAdvanced((current) => !current)}
              type="button"
            >
              <span>Advanced</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform",
                  showAdvanced && "rotate-180",
                )}
              />
            </button>

            {showAdvanced ? (
              <div className="grid gap-2">
                <Controller
                  control={form.control}
                  name="stylePrompt"
                  render={({ field, fieldState }) => (
                    <FieldShell
                      error={fieldState.error?.message}
                      label="Style prompt"
                    >
                      <Textarea
                        {...field}
                        aria-invalid={fieldState.invalid || undefined}
                        className="min-h-16 resize-none text-label"
                        maxLength={2000}
                        rows={3}
                      />
                    </FieldShell>
                  )}
                />

                <Controller
                  control={form.control}
                  name="imageSize"
                  render={({ field, fieldState }) => (
                    <FieldShell
                      error={fieldState.error?.message}
                      label="Image size"
                    >
                      <div className="grid grid-cols-3 gap-1">
                        {GENERATED_IMAGE_SIZES.map((size) => (
                          <button
                            aria-pressed={field.value === size}
                            className={cn(toggleButtonClassName)}
                            key={size}
                            onClick={() => field.onChange(size)}
                            type="button"
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </FieldShell>
                  )}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 border-border/80 border-t p-panel">
          {rootError ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-label-sm text-destructive"
              role="alert"
            >
              {rootError}
            </p>
          ) : null}

          <Button
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="w-full"
            disabled={isEnhancingPrompt}
            leftSection={<Sparkles aria-hidden="true" />}
            loading={isGenerating}
            size="sm"
            type="submit"
          >
            Generate
          </Button>
        </div>
      </form>

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border/80 bg-card/45">
        {generatedImage ? (
          <span className="pointer-events-none absolute top-3 right-3 z-10 truncate rounded-md border border-border/80 bg-background/80 px-2 py-1 text-caption text-muted-foreground backdrop-blur">
            {generatedImage.model} · {generatedImage.aspectRatio} ·{" "}
            {generatedImage.imageSize}
          </span>
        ) : null}

        {generatedImage ? (
          <Button
            aria-label="Download image"
            asChild
            className="absolute right-4 bottom-4 z-20 size-9 rounded-full shadow-md"
            size="icon"
            tooltip="Download image"
            tooltipSide="left"
          >
            <a
              download={getGeneratedImageDownloadFilename(generatedImage)}
              href={getGeneratedImageDownloadUrl(generatedImage.contentUrl)}
            >
              <Download aria-hidden="true" className="size-4" />
            </a>
          </Button>
        ) : null}

        <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
          {isGenerating ? (
            <div className="grid gap-3 text-center text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                className="mx-auto size-7 animate-spin text-primary"
              />
              <p className="text-body">Generating image...</p>
            </div>
          ) : generatedImage ? (
            <Link
              aria-label="Open generated image preview"
              className={cn(
                "relative block h-full w-full overflow-hidden rounded-md outline-none transition-[background-color,box-shadow]",
                "hover:bg-background/45 focus-visible:ring-[3px] focus-visible:ring-ring/35",
              )}
              href={`/images/${generatedImage.id}?from=generate`}
            >
              <Image
                alt={generatedImage.prompt}
                className="object-contain"
                fill
                sizes="(min-width: 1024px) calc(100vw - 22rem), 100vw"
                src={generatedImage.contentUrl}
                unoptimized
              />
            </Link>
          ) : (
            <div className="grid max-w-sm gap-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border/80 bg-muted/70 text-muted-foreground">
                <ImageIcon aria-hidden="true" className="size-5" />
              </div>
              <p className="text-body text-muted-foreground">
                Generated images appear here and are saved to the local gallery.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FieldShell({
  action,
  children,
  error,
  label,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <div className="grid gap-1">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <Label className="text-label-sm">{label}</Label>
        {action}
      </div>
      {children}
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
    </div>
  );
}

const COMMON_ASPECT_RATIOS: GenerateImageFormValues["aspectRatio"][] = [
  "9:16",
  "3:4",
  "4:3",
  "16:9",
];

const OTHER_ASPECT_RATIOS = GENERATED_IMAGE_ASPECT_RATIOS.filter(
  (ratio) => !COMMON_ASPECT_RATIOS.includes(ratio),
);

const selectClassName =
  "flex h-8 w-full rounded-md border border-input bg-card/80 px-2.5 py-1 text-label shadow-xs transition-[background-color,border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

const toggleButtonClassName =
  "h-7 rounded-md border border-border/80 bg-muted/45 text-label-sm text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/45 hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 aria-pressed:border-primary/45 aria-pressed:bg-primary/15 aria-pressed:text-foreground";

function isGenerationShortcut(event: KeyboardEvent) {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.nativeEvent.isComposing
  );
}
