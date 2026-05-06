"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { Controller } from "react-hook-form";

import {
  type UpdateStoryFormValues,
  updateStoryFormSchema,
} from "@/actions/stories/_schemas";
import { deleteStory } from "@/actions/stories/delete-story";
import { updateStory } from "@/actions/stories/update-story";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/common/dialog";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { formResolver } from "@/lib/schemas/resolve";

type EditStoryDetailsDialogProps = {
  story: {
    id: string;
    name: string;
    description: string;
  };
};

export function EditStoryDetailsDialog({ story }: EditStoryDetailsDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const { form, action, resetFormAndAction } = useHookFormAction(
    updateStory,
    formResolver(updateStoryFormSchema),
    {
      formProps: {
        defaultValues: {
          id: story.id,
          name: story.name,
          description: story.description,
        },
      },
    },
  );
  const deleteAction = useAction(deleteStory);
  const isUpdating = action.isPending;
  const isDeleting = deleteAction.isPending;
  const deleteError =
    deleteAction.result.validationErrors?.formErrors[0] ??
    deleteAction.result.serverError?.message;
  const rootError = form.formState.errors.root?.message ?? deleteError;

  function resetToStory() {
    resetFormAndAction();
    form.reset({
      id: story.id,
      name: story.name,
      description: story.description,
    });
  }

  function handleOpenChange(open: boolean) {
    if (isDeleting) {
      return;
    }

    setIsOpen(open);
    setIsConfirmingDelete(false);
    deleteAction.reset();
    resetToStory();
  }

  async function handleUpdateStory(values: UpdateStoryFormValues) {
    form.clearErrors("root");
    deleteAction.reset();
    setIsConfirmingDelete(false);

    const result = await action.executeAsync(values);

    if (result.data) {
      resetFormAndAction();
      setIsOpen(false);
      router.refresh();
      return;
    }

    const rootMessage =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : "The story could not be updated.");

    if (rootMessage) {
      form.setError("root", {
        message: rootMessage,
      });
    }
  }

  function handleRequestDelete() {
    form.clearErrors("root");
    deleteAction.reset();
    setIsConfirmingDelete(true);
  }

  function handleCancelDelete() {
    deleteAction.reset();
    setIsConfirmingDelete(false);
  }

  async function handleConfirmDelete() {
    form.clearErrors("root");

    const result = await deleteAction.executeAsync({
      id: story.id,
    });

    if (result.data) {
      resetFormAndAction();
      setIsOpen(false);
      router.replace("/");
      return;
    }

    const rootMessage =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : "The story could not be deleted.");

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
          leftSection={<Pencil aria-hidden="true" />}
          type="button"
          variant="outline"
        >
          Edit
        </Button>
      </DialogTrigger>

      <DialogContent className="gap-0">
        <DialogHeader className="border-border/80 border-b p-panel pr-12">
          <DialogTitle>Edit story details</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the story name and description or delete the story.
          </DialogDescription>
        </DialogHeader>

        <form
          autoComplete="off"
          className="grid gap-4 px-panel pt-4 pb-panel"
          onSubmit={form.handleSubmit(handleUpdateStory)}
        >
          <input type="hidden" {...form.register("id")} />

          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <div className="grid gap-2">
                <Label htmlFor="edit-story-name">Story name</Label>
                <Input
                  {...field}
                  aria-describedby={
                    fieldState.error ? "edit-story-name-error" : undefined
                  }
                  aria-invalid={fieldState.invalid || undefined}
                  autoComplete="off"
                  autoFocus
                  id="edit-story-name"
                  maxLength={120}
                  spellCheck={false}
                />
                {fieldState.error ? (
                  <p
                    className="text-caption text-destructive"
                    id="edit-story-name-error"
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
                <Label htmlFor="edit-story-description">Description</Label>
                <Textarea
                  {...field}
                  aria-describedby={
                    fieldState.error
                      ? "edit-story-description-error"
                      : undefined
                  }
                  aria-invalid={fieldState.invalid || undefined}
                  autoComplete="off"
                  className="min-h-32 resize-none"
                  id="edit-story-description"
                  maxLength={600}
                />
                {fieldState.error ? (
                  <p
                    className="text-caption text-destructive"
                    id="edit-story-description-error"
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

          {isConfirmingDelete ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
              role="alert"
            >
              <p className="text-label text-destructive">Delete this story?</p>
              <p className="mt-1 text-body text-destructive/90">
                This will permanently delete "{story.name}" and all of its
                chapters.
              </p>
            </div>
          ) : null}

          {isConfirmingDelete ? (
            <DialogFooter className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <Button
                className="justify-self-start"
                leftSection={<Trash2 aria-hidden="true" />}
                loading={isDeleting}
                onClick={handleConfirmDelete}
                type="button"
                variant="destructive"
              >
                Delete Story
              </Button>
              <Button
                className="justify-self-start sm:justify-self-end"
                disabled={isDeleting}
                onClick={handleCancelDelete}
                type="button"
              >
                Keep Story
              </Button>
            </DialogFooter>
          ) : (
            <DialogFooter className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <Button
                className="justify-self-start"
                disabled={isUpdating}
                leftSection={<Trash2 aria-hidden="true" />}
                onClick={handleRequestDelete}
                type="button"
                variant="destructive"
              >
                Delete
              </Button>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button
                  disabled={isDeleting}
                  leftSection={<Pencil aria-hidden="true" />}
                  loading={isUpdating}
                  type="submit"
                >
                  Save
                </Button>
              </div>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
