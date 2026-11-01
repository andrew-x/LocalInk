"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { formResolver } from "@/lib/schemas/resolve";
import { STUDIO_ASPECTS } from "@/lib/studio/bible-templates";
import {
  type StudioAspect,
  type StudioEntryDto,
  studioAspectSchema,
} from "@/lib/studio/contracts";

export type ChangeFormValues = {
  entryId: string;
  aspect: StudioAspect;
  aboutEntryId: string | null;
  value: string;
};

const changeFormSchema = z.object({
  entryId: z.string().min(1, "Pick who or what changes."),
  aspect: studioAspectSchema,
  aboutEntryId: z.string(),
  value: z.string().trim().min(1, "Say what changes.").max(4000),
});

type ChangeFormInput = z.infer<typeof changeFormSchema>;

type ChangeFormProps = {
  entries: StudioEntryDto[];
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
  initial,
  lockEntry = false,
  mode,
  onCancel,
  onSubmit,
}: ChangeFormProps) {
  const form = useForm<ChangeFormInput>({
    defaultValues: {
      entryId: initial?.entryId ?? "",
      aspect: initial?.aspect ?? "knows",
      aboutEntryId: initial?.aboutEntryId ?? "",
      value: initial?.value ?? "",
    },
    resolver: formResolver(changeFormSchema),
  });
  const { errors, isSubmitting } = form.formState;
  const aspect = form.watch("aspect");
  const showAbout = aspect === "feels" || Boolean(initial?.aboutEntryId);
  const idPrefix = useId();

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({
      entryId: values.entryId,
      aspect: values.aspect,
      aboutEntryId:
        showAbout && values.aboutEntryId ? values.aboutEntryId : null,
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
          <select
            className={SELECT_CLASS}
            id={`${idPrefix}-aspect`}
            {...form.register("aspect")}
          >
            {STUDIO_ASPECTS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {showAbout ? (
        <div className="flex flex-col gap-1">
          <Label
            className="text-caption text-muted-foreground"
            htmlFor={`${idPrefix}-about`}
          >
            About
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
      ) : null}
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
      {errors.entryId || errors.value ? (
        <p className="text-caption text-destructive" role="alert">
          {errors.entryId?.message ?? errors.value?.message}
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
