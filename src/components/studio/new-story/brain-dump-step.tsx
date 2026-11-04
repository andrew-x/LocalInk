"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Controller } from "react-hook-form";
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
        defaultValues: { title: "", brainDump: "", instructions: "" },
      },
    },
  );
  const rootError = form.formState.errors.root?.message;

  async function handleCreate(values: CreateStudioStoryFormValues) {
    form.clearErrors("root");

    const result = await action.executeAsync(values);
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

      <Controller
        control={form.control}
        name="instructions"
        render={({ field, fieldState }) => (
          <div className="grid gap-2">
            <Label htmlFor="studio-instructions">How should it sound?</Label>
            <Textarea
              {...field}
              aria-describedby={
                fieldState.error ? "studio-instructions-error" : undefined
              }
              aria-invalid={fieldState.invalid || undefined}
              autoComplete="off"
              className="min-h-24 font-content"
              id="studio-instructions"
              maxLength={8000}
              placeholder="Who's telling it and how they talk, how close the reader should be, anything it must never do."
              value={field.value ?? ""}
            />
            <FieldError
              id="studio-instructions-error"
              message={fieldState.error?.message}
            />
          </div>
        )}
      />

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
