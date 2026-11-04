"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/common/dialog";

import { ModelsSection } from "./models-section";
import { StructureSection } from "./structure-section";
import { ThemeSection } from "./theme-section";

/**
 * Story-level settings: theme, structure and models. The voice (including
 * "In your words") lives on the Studio Voice tab, and the premise in the
 * outline.
 */
export function StorySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col gap-0 p-0 sm:max-w-3xl">
        <div className="flex min-h-12 shrink-0 items-center border-border/80 border-b px-5">
          <DialogTitle className="font-serif text-heading">
            Story settings
          </DialogTitle>
          <DialogDescription className="sr-only">
            Theme, structure and models for this story. Changes save as you
            type.
          </DialogDescription>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 py-5">
          <ThemeSection />
          <StructureSection />
          <ModelsSection />
        </div>
      </DialogContent>
    </Dialog>
  );
}
