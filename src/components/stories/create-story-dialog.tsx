"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller } from "react-hook-form";

import {
  type CreateStoryFormValues,
  createStoryFormSchema,
} from "@/actions/stories/_schemas";
import { createStory } from "@/actions/stories/create-story";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/common/dialog";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { formResolver } from "@/lib/schemas/resolve";

export function CreateStoryDialog() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const { form, action, resetFormAndAction } = useHookFormAction(
    createStory,
    formResolver(createStoryFormSchema),
    {
      formProps: {
        defaultValues: {
          name: "",
          description: "",
        },
      },
    },
  );
  const isCreating = action.isPending;
  const rootError = form.formState.errors.root?.message;

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    resetFormAndAction();
  }

  async function handleCreateStory(values: CreateStoryFormValues) {
    form.clearErrors("root");

    const result = await action.executeAsync(values);
    if (result.data) {
      resetFormAndAction();
      setIsOpen(false);
      router.push(`/story/${result.data.id}`);
      return;
    }

    const rootMessage =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : "The story could not be created.");

    if (rootMessage) {
      form.setError("root", {
        message: rootMessage,
      });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          className="w-full sm:w-auto"
          leftSection={<Plus aria-hidden="true" />}
          size="lg"
        >
          New Story
        </Button>
      </DialogTrigger>

      <DialogContent className="gap-0">
        <DialogHeader className="border-border/80 border-b p-panel pr-12">
          <DialogTitle>Create story</DialogTitle>
        </DialogHeader>

        <form
          autoComplete="off"
          className="grid gap-4 px-panel pt-4 pb-panel"
          onSubmit={form.handleSubmit(handleCreateStory)}
        >
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>Story name</Label>
                <Input
                  {...field}
                  aria-describedby={
                    fieldState.error ? "story-name-error" : undefined
                  }
                  aria-invalid={fieldState.invalid || undefined}
                  autoFocus
                  autoComplete="off"
                  id={field.name}
                  maxLength={120}
                  spellCheck={false}
                />
                {fieldState.error ? (
                  <p
                    className="text-caption text-destructive"
                    id="story-name-error"
                  >
                    {fieldState.error.message}
                  </p>
                ) : null}
              </div>
            )}
          />

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>Description</Label>
                <Textarea
                  {...field}
                  aria-describedby={
                    fieldState.error ? "story-description-error" : undefined
                  }
                  aria-invalid={fieldState.invalid || undefined}
                  autoComplete="off"
                  className="min-h-32 resize-none"
                  id={field.name}
                  maxLength={600}
                />
                {fieldState.error ? (
                  <p
                    className="text-caption text-destructive"
                    id="story-description-error"
                  >
                    {fieldState.error.message}
                  </p>
                ) : null}
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

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              leftSection={<Plus aria-hidden="true" />}
              loading={isCreating}
              type="submit"
            >
              Create Story
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
