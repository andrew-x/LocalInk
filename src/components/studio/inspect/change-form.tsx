"use client";

import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { formResolver } from "@/lib/schemas/resolve";
import {
  entryAspectLabels,
  modeForLabel,
  suggestionForLabel,
  unusedAspectSuggestions,
} from "@/lib/studio/aspects";
import {
  type StudioAspect,
  type StudioChangeDto,
  type StudioChangeMode,
  type StudioEntryDto,
  studioAspectSchema,
} from "@/lib/studio/contracts";

export type ChangeFormValues = {
  entryId: string;
  aspect: StudioAspect;
  mode: StudioChangeMode;
  aboutEntryId: string | null;
  value: string;
};

const MODE_OPTIONS: { mode: StudioChangeMode; label: string }[] = [
  { mode: "set", label: "Replaces" },
  { mode: "add", label: "Adds to list" },
];

const changeFormSchema = z.object({
  entryId: z.string().min(1, "Pick who or what changes."),
  aspect: studioAspectSchema,
  aboutEntryId: z.string(),
  value: z.string().trim().min(1, "Say what changes.").max(4000),
});

type ChangeFormInput = z.infer<typeof changeFormSchema>;

type ChangeFormProps = {
  entries: StudioEntryDto[];
  /** All of the story's changes; the form suggests this entry's labels. */
  changes: StudioChangeDto[];
  initial?: Partial<ChangeFormValues>;
  /** Shows the entry as fixed text; an existing record keeps its entry. */
  lockEntry?: boolean;
  mode: "create" | "edit";
  onCancel: () => void;
  /** Resolves true when saved; false keeps the form open (the caller toasts). */
  onSubmit: (values: ChangeFormValues) => Promise<boolean>;
};

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-card/80 px-2 text-label-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

/** Entry, aspect, about and value for one change record. Shared with the Bible. */
export function ChangeForm({
  entries,
  changes,
  initial,
  lockEntry = false,
  mode,
  onCancel,
  onSubmit,
}: ChangeFormProps) {
  const form = useForm<ChangeFormInput>({
    defaultValues: {
      entryId: initial?.entryId ?? "",
      aspect: initial?.aspect ?? "",
      aboutEntryId: initial?.aboutEntryId ?? "",
      value: initial?.value ?? "",
    },
    resolver: formResolver(changeFormSchema),
  });
  const { errors, isSubmitting } = form.formState;
  const entryId = form.watch("entryId");
  const aspect = form.watch("aspect");
  const [pickedMode, setPickedMode] = useState<StudioChangeMode | null>(
    initial?.mode ?? null,
  );
  const { planItems } = useStudioStore().state;
  const existingLabels = entryAspectLabels(changes, entryId, planItems);
  const suggestionLabels = unusedAspectSuggestions(existingLabels).map(
    (item) => item.label,
  );
  // Until the author picks a mode, follow the label: an existing label keeps
  // its mode, a suggested one uses the suggestion's, anything else replaces.
  const matchedMode =
    modeForLabel(changes, entryId, aspect, planItems) ??
    suggestionForLabel(aspect)?.mode ??
    "set";
  const changeMode = pickedMode ?? matchedMode;
  const idPrefix = useId();

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({
      entryId: values.entryId,
      aspect: values.aspect.trim(),
      mode: changeMode,
      aboutEntryId: values.aboutEntryId || null,
      value: values.value.trim(),
    });
  });

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-border bg-card/40 p-2"
      noValidate
      onSubmit={(event) => {
        event.stopPropagation();
        void submit(event);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label
            className="text-caption text-muted-foreground"
            htmlFor={`${idPrefix}-entry`}
          >
            Who or what
          </Label>
          {lockEntry ? (
            <p
              className="flex h-8 items-center truncate text-label-sm"
              id={`${idPrefix}-entry`}
            >
              {entries.find((entry) => entry.id === initial?.entryId)?.name ??
                "Unknown entry"}
            </p>
          ) : (
            <select
              aria-invalid={Boolean(errors.entryId)}
              className={SELECT_CLASS}
              id={`${idPrefix}-entry`}
              {...form.register("entryId")}
            >
              <option value="">Choose…</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label
            className="text-caption text-muted-foreground"
            htmlFor={`${idPrefix}-aspect`}
          >
            Aspect
          </Label>
          <Input
            aria-invalid={Boolean(errors.aspect)}
            autoComplete="off"
            className="h-8"
            id={`${idPrefix}-aspect`}
            list={`${idPrefix}-aspect-options`}
            maxLength={60}
            placeholder="e.g. Trusts Mara"
            {...form.register("aspect")}
          />
          <datalist id={`${idPrefix}-aspect-options`}>
            {[...existingLabels, ...suggestionLabels].map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
      </div>
      <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
        <legend className="sr-only">How this change applies</legend>
        <span className="mr-1 text-caption text-muted-foreground">
          This change
        </span>
        {MODE_OPTIONS.map((option) => (
          <Button
            aria-pressed={changeMode === option.mode}
            key={option.mode}
            onClick={() => setPickedMode(option.mode)}
            size="sm"
            type="button"
            variant={changeMode === option.mode ? "secondary" : "ghost"}
          >
            {option.label}
          </Button>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <Label
          className="text-caption text-muted-foreground"
          htmlFor={`${idPrefix}-about`}
        >
          About (optional)
        </Label>
        <select
          className={SELECT_CLASS}
          id={`${idPrefix}-about`}
          {...form.register("aboutEntryId")}
        >
          <option value="">Nobody in particular</option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label
          className="text-caption text-muted-foreground"
          htmlFor={`${idPrefix}-value`}
        >
          Now
        </Label>
        <Input
          aria-invalid={Boolean(errors.value)}
          className="h-8"
          id={`${idPrefix}-value`}
          maxLength={4000}
          placeholder="What is true from here on"
          {...form.register("value")}
        />
      </div>
      {errors.entryId || errors.aspect || errors.value ? (
        <p className="text-caption text-destructive" role="alert">
          {errors.entryId?.message ??
            (errors.aspect
              ? "Name what changes (up to 60 characters)."
              : undefined) ??
            errors.value?.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button loading={isSubmitting} size="sm" type="submit">
          {mode === "create" ? "Add change" : "Save"}
        </Button>
      </div>
    </form>
  );
}
