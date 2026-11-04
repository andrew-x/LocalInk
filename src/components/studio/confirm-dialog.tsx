"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";

type StudioConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  loading?: boolean;
};

/**
 * Confirmation dialog in the app's dialog layout. The shared DialogContent has
 * no padding of its own; every LocalInk dialog pads its header and body, so
 * Studio confirmations go through this one component instead of repeating it.
 */
export function StudioConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  loading = false,
}: StudioConfirmDialogProps) {
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!loading) onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent className="gap-0">
        <DialogHeader className="p-panel pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="px-panel pb-panel">
          <Button
            disabled={loading}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            loading={loading}
            onClick={onConfirm}
            type="button"
            variant={destructive ? "destructive" : "default"}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
