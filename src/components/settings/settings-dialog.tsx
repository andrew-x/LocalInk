"use client";

import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks";
import { Save, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { toast } from "sonner";

import {
  type SettingsFormValues,
  settingsFormSchema,
} from "@/actions/settings/_schemas";
import type { AppSettings } from "@/actions/settings/_types";
import { updateSettings } from "@/actions/settings/update-settings";
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
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/common/tooltip";
import { formResolver } from "@/lib/schemas/resolve";

type SettingsDialogProps = {
  settings: AppSettings;
};

export function SettingsDialog({ settings }: SettingsDialogProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState(settings);
  const { form, action, resetFormAndAction } = useHookFormAction(
    updateSettings,
    formResolver(settingsFormSchema),
    {
      formProps: {
        defaultValues: settings,
      },
    },
  );
  const isSaving = action.isPending;
  const rootError = form.formState.errors.root?.message;

  function resetToSavedSettings(nextSettings = savedSettings) {
    resetFormAndAction();
    form.reset(nextSettings);
  }

  function handleOpenChange(open: boolean) {
    if (isSaving) {
      return;
    }

    setIsOpen(open);
    resetToSavedSettings();
  }

  async function handleSaveSettings(values: SettingsFormValues) {
    form.clearErrors("root");

    const result = await action.executeAsync(values);

    if (result.data) {
      setSavedSettings(result.data);
      action.reset();
      form.reset(result.data);
      setIsOpen(false);
      toast.success("Settings saved.");
      router.refresh();
      return;
    }

    const rootMessage =
      result.validationErrors?.formErrors[0] ??
      result.serverError?.message ??
      (result.validationErrors ? undefined : "Settings could not be saved.");

    if (rootMessage) {
      form.setError("root", {
        message: rootMessage,
      });
      toast.error(rootMessage);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                aria-label="Settings"
                className="size-10"
                size="icon"
                type="button"
                variant="outline"
              >
                <Settings aria-hidden="true" />
                <span className="sr-only">Settings</span>
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent className="gap-0 sm:max-w-2xl">
        <DialogHeader className="border-border/80 border-b p-panel pr-12">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Set global AI system instructions for future prose and chat
            generations.
          </DialogDescription>
        </DialogHeader>

        <form
          autoComplete="off"
          className="grid gap-4 px-panel pt-4 pb-panel"
          onSubmit={form.handleSubmit(handleSaveSettings)}
        >
          <Controller
            control={form.control}
            name="systemInstructions"
            render={({ field, fieldState }) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>System instructions</Label>
                <Textarea
                  {...field}
                  aria-describedby={
                    fieldState.error ? "system-instructions-error" : undefined
                  }
                  aria-invalid={fieldState.invalid || undefined}
                  autoFocus
                  autoComplete="off"
                  className="min-h-72 resize-y"
                  id={field.name}
                  maxLength={8000}
                />
                {fieldState.error ? (
                  <p
                    className="text-caption text-destructive"
                    id="system-instructions-error"
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
              <Button disabled={isSaving} type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              leftSection={<Save aria-hidden="true" />}
              loading={isSaving}
              type="submit"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
