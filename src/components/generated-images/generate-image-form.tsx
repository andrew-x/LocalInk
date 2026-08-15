"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  type GenerateImageFormValues,
  generateImageFormSchema,
} from "@/actions/generated-images/_schemas";
import { enhanceImagePrompt } from "@/actions/generated-images/enhance-image-prompt";
import { Button } from "@/components/common/button";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import {
  type GenerateImageRequest,
  MAX_CONCURRENT_IMAGE_GENERATIONS,
} from "@/lib/generated-image-generation-contract";
import {
  GENERATED_IMAGE_ASPECT_RATIOS,
  GENERATED_IMAGE_MODELS,
  GENERATED_IMAGE_SIZES,
  GENERATED_IMAGE_STYLE_PRESET_OPTIONS,
  getGeneratedImageStylePresetPrompt,
} from "@/lib/generated-images";
import { formResolver } from "@/lib/schemas/resolve";
import { cn } from "@/lib/util";

type PromptSource = "input" | "enhanced";

type GenerateImageFormProps = {
  activeCount: number;
  defaultValues: GenerateImageFormValues;
  /** The enhanced description the prefilled image was generated from, if any. */
  initialEnhancedPrompt?: string | null;
  isAtConcurrencyLimit: boolean;
  /** Returns the new job id, or null when the concurrency cap is reached. */
  onGenerate: (values: GenerateImageRequest) => string | null;
};

export function GenerateImageForm({
  activeCount,
  defaultValues,
  initialEnhancedPrompt,
  isAtConcurrencyLimit,
  onGenerate,
}: GenerateImageFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMoreRatios, setShowMoreRatios] = useState(
    () => !COMMON_ASPECT_RATIOS.includes(defaultValues.aspectRatio),
  );
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(
    initialEnhancedPrompt ?? null,
  );
  // A restored enhancement starts selected so generating an unchanged prefill
  // reproduces the source image. Editing the description flips it back.
  const [promptSource, setPromptSource] = useState<PromptSource>(
    initialEnhancedPrompt ? "enhanced" : "input",
  );
  // `useHookFormAction` only exists to bridge to next-safe-action. Generation
  // now goes through a Route Handler, so React Hook Form is wired directly.
  //
  // Three generics because the schema uses `.default()` on four fields, so its
  // input type has them optional while its output type does not. The submit
  // handler receives the parsed output.
  const form = useForm<
    z.input<typeof generateImageFormSchema>,
    unknown,
    GenerateImageFormValues
  >({
    defaultValues,
    resolver: formResolver(generateImageFormSchema),
  });
  const enhancePromptAction = useAction(enhanceImagePrompt);
  const stylePreset = form.watch("stylePreset");
  const stylePrompt = form.watch("stylePrompt");
  const isEnhancingPrompt = enhancePromptAction.isPending;
  const hasEnhancedPrompt = Boolean(enhancedPrompt?.trim());
  const selectedPromptSource =
    promptSource === "enhanced" && hasEnhancedPrompt ? "enhanced" : "input";
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

  function handleGenerate(values: GenerateImageFormValues) {
    form.clearErrors("root");

    // `prompt` stays the user's own wording. The server sends `enhancedPrompt`
    // when it is set and keeps `prompt` as the original beside it, so coming
    // back to this image later prefills what the user actually wrote.
    const jobId = onGenerate({
      ...values,
      enhancedPrompt:
        selectedPromptSource === "enhanced" && enhancedPrompt
          ? enhancedPrompt
          : undefined,
    });

    if (!jobId) {
      const message = `Up to ${MAX_CONCURRENT_IMAGE_GENERATIONS} generations can run at once.`;

      form.setError("root", { message });
      toast.error(message);
    }
  }

  async function handleEnhancePrompt() {
    if (isEnhancingPrompt || !form.getValues("prompt").trim()) {
      return;
    }

    form.clearErrors("root");
    form.clearErrors("prompt");

    const result = await enhancePromptAction.executeAsync(form.getValues());

    if (result.data) {
      setEnhancedPrompt(result.data.prompt);
      setPromptSource("enhanced");
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
    if (!isGenerationShortcut(event) || isEnhancingPrompt) {
      return;
    }

    event.preventDefault();
    event.currentTarget.requestSubmit();
  }

  return (
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
          render={({ field, fieldState }) => {
            const canEnhancePrompt = Boolean(field.value?.trim());

            return (
              <FieldShell
                error={fieldState.error?.message}
                label="Image description"
                action={
                  <Button
                    aria-label="Enhance image description"
                    className="size-6 p-0 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    disabled={isEnhancingPrompt || !canEnhancePrompt}
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
                  className="min-h-36 resize-none text-label"
                  maxLength={4000}
                  // Editing the description is a choice to generate from it, so
                  // an enhancement selected beforehand stops winning silently.
                  // It stays in the preview, one toggle away.
                  onChange={(event) => {
                    field.onChange(event);
                    setPromptSource("input");
                  }}
                  placeholder="A rain-slick alley outside a tiny midnight print shop..."
                  rows={6}
                />
                {enhancedPrompt ? (
                  <EnhancedPromptChoice
                    onPromptSourceChange={setPromptSource}
                    prompt={enhancedPrompt}
                    promptSource={selectedPromptSource}
                  />
                ) : null}
              </FieldShell>
            );
          }}
        />

        <Controller
          control={form.control}
          name="aspectRatio"
          render={({ field, fieldState }) => (
            <FieldShell error={fieldState.error?.message} label="Aspect ratio">
              <div className="grid gap-1">
                <div className="grid grid-cols-5 gap-1">
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

        {activeCount > 0 ? (
          <p className="text-center text-caption text-muted-foreground">
            {activeCount === 1
              ? "1 generation running"
              : `${activeCount} generations running`}
          </p>
        ) : null}

        {/*
          Deliberately `aria-disabled` rather than `disabled`: at the cap the
          button becomes unavailable in response to the user's own click, and a
          truly disabled button would drop their focus to <body>.
        */}
        <Button
          aria-disabled={isAtConcurrencyLimit || undefined}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          className={cn(
            "w-full",
            isAtConcurrencyLimit && "opacity-60 hover:bg-primary",
          )}
          disabled={isEnhancingPrompt}
          leftSection={<Sparkles aria-hidden="true" />}
          size="sm"
          type="submit"
        >
          Generate
        </Button>
      </div>
    </form>
  );
}

function EnhancedPromptChoice({
  onPromptSourceChange,
  prompt,
  promptSource,
}: {
  onPromptSourceChange: (source: PromptSource) => void;
  prompt: string;
  promptSource: PromptSource;
}) {
  const useEnhancedPrompt = promptSource === "enhanced";

  return (
    <div className="grid gap-2 rounded-md border border-border/80 bg-card/65 p-2.5 shadow-xs">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="block truncate text-label-sm">
            Enhanced prompt
          </Label>
          <p className="truncate text-caption text-muted-foreground">
            {useEnhancedPrompt ? "Used for generation" : "Preview only"}
          </p>
        </div>
        <button
          aria-checked={useEnhancedPrompt}
          aria-label="Use enhanced prompt for generation"
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35",
            useEnhancedPrompt
              ? "border-primary/55 bg-primary"
              : "border-border/80 bg-muted/70 hover:bg-muted",
          )}
          onClick={() =>
            onPromptSourceChange(useEnhancedPrompt ? "input" : "enhanced")
          }
          role="switch"
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-5 rounded-full bg-background shadow-xs transition-transform",
              useEnhancedPrompt && "translate-x-5",
            )}
          />
        </button>
      </div>
      <div
        className={cn(
          "max-h-64 min-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border px-2.5 py-2 text-label-sm leading-relaxed transition-[background-color,border-color,color]",
          useEnhancedPrompt
            ? "border-primary/35 bg-background text-foreground shadow-xs"
            : "border-border/70 bg-background/45 text-muted-foreground",
        )}
      >
        {prompt}
      </div>
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
  "1:1",
  "3:4",
  "4:3",
  "9:16",
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
