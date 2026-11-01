"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray } from "react-hook-form";
import { toast } from "sonner";

import {
  type CreateStudioStoryFormValues,
  createStudioStoryFormSchema,
} from "@/actions/studio/_schemas";
import { createStudioStory } from "@/actions/studio/create-studio-story";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { formResolver } from "@/lib/schemas/resolve";
import {
  STUDIO_MAX_VOICE_SAMPLE_CHARS,
  STUDIO_MAX_VOICE_SAMPLES,
} from "@/lib/studio/contracts";
import { generateId } from "@/lib/util";

type BrainDumpStepProps = {
  onCreated: (story: { id: string; title: string }) => void;
};

const CREATE_FAILED_MESSAGE = "The story could not be created.";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="text-caption text-destructive" id={id}>
      {message}
    </p>
  );
}

export function BrainDumpStep({ onCreated }: BrainDumpStepProps) {
  const { form, action } = useHookFormAction(
    createStudioStory,
    formResolver(createStudioStoryFormSchema),
    {
      formProps: {
        defaultValues: { title: "", brainDump: "", voiceSamples: [] },
      },
    },
  );
  const samples = useFieldArray({
    control: form.control,
    // The default key name would overwrite each sample's own `id`.
    keyName: "fieldKey",
    name: "voiceSamples",
  });
  const rootError = form.formState.errors.root?.message;

  async function handleCreate(values: CreateStudioStoryFormValues) {
    form.clearErrors("root");

    const voiceSamples = (values.voiceSamples ?? [])
      .filter((sample) => sample.text.trim())
      .map((sample, index) => ({
        id: sample.id,
        label: sample.label.trim() || `Sample ${index + 1}`,
        text: sample.text,
      }));

    const result = await action.executeAsync({ ...values, voiceSamples });
    if (result.data) {
      onCreated({ id: result.data.id, title: result.data.title });
      return;
    }

    const message =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : CREATE_FAILED_MESSAGE);

    if (message) {
      form.setError("root", { message });
      toast.error(message);
    }
  }

  return (
    <form
      autoComplete="off"
      className="grid gap-6"
      onSubmit={form.handleSubmit(handleCreate, () =>
        toast.error("Check the highlighted fields and try again."),
      )}
    >
      <div>
        <h1 className="font-serif text-title">New story</h1>
        <p className="mt-1 text-body text-muted-foreground">
          Pour out everything you have so far: characters, scenes, a feeling, a
          few lines. It does not need to be organized.
        </p>
      </div>

      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <div className="grid gap-2">
            <Label htmlFor="studio-title">Title</Label>
            <Input
              {...field}
              aria-describedby={
                fieldState.error ? "studio-title-error" : undefined
              }
              aria-invalid={fieldState.invalid || undefined}
              autoComplete="off"
              autoFocus
              id="studio-title"
              maxLength={120}
              spellCheck={false}
            />
            <FieldError
              id="studio-title-error"
              message={fieldState.error?.message}
            />
          </div>
        )}
      />

      <Controller
        control={form.control}
        name="brainDump"
        render={({ field, fieldState }) => (
          <div className="grid gap-2">
            <Label htmlFor="studio-brain-dump">Brain dump</Label>
            <Textarea
              {...field}
              aria-describedby={
                fieldState.error ? "studio-brain-dump-error" : undefined
              }
              aria-invalid={fieldState.invalid || undefined}
              autoComplete="off"
              className="min-h-72 font-content"
              id="studio-brain-dump"
              maxLength={40_000}
            />
            <FieldError
              id="studio-brain-dump-error"
              message={fieldState.error?.message}
            />
          </div>
        )}
      />

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-heading">Writing samples</h2>
            <p className="text-label text-muted-foreground">
              Optional. Add a passage that sounds like you so drafts can match
              your voice.
            </p>
          </div>
          {samples.fields.length < STUDIO_MAX_VOICE_SAMPLES ? (
            <Button
              leftSection={<Plus aria-hidden="true" />}
              onClick={() =>
                samples.append({
                  id: generateId("studio-voice"),
                  label: "",
                  text: "",
                })
              }
              size="sm"
              type="button"
              variant="outline"
            >
              Add a writing sample
            </Button>
          ) : null}
        </div>

        {samples.fields.map((sample, index) => (
          <div
            className="grid gap-3 rounded-lg border border-border/80 bg-card/45 p-4"
            key={sample.fieldKey}
          >
            <div className="flex items-end gap-2">
              <div className="grid flex-1 gap-2">
                <Label htmlFor={`studio-sample-label-${index}`}>Label</Label>
                <Input
                  {...form.register(`voiceSamples.${index}.label`)}
                  autoComplete="off"
                  id={`studio-sample-label-${index}`}
                  maxLength={80}
                  placeholder={`Sample ${index + 1}`}
                />
              </div>
              <Button
                aria-label={`Remove writing sample ${index + 1}`}
                onClick={() => samples.remove(index)}
                size="icon"
                tooltip="Remove sample"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`studio-sample-text-${index}`}>Text</Label>
              <Textarea
                {...form.register(`voiceSamples.${index}.text`)}
                autoComplete="off"
                className="min-h-32 font-content"
                id={`studio-sample-text-${index}`}
                maxLength={STUDIO_MAX_VOICE_SAMPLE_CHARS}
              />
            </div>
          </div>
        ))}
      </div>

      {rootError ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
          role="alert"
        >
          {rootError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button loading={action.isPending} size="lg" type="submit">
          Continue
        </Button>
      </div>
    </form>
  );
}
