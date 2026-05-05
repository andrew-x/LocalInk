"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { Button } from "@/components/common/button";
import { cn } from "@/lib/util";

type StoryEditorPaneHeaderProps = {
  isOpen: boolean;
  label: string;
  onToggle: () => void;
  side: "left" | "right";
};

export function StoryEditorPaneHeader({
  isOpen,
  label,
  onToggle,
  side,
}: StoryEditorPaneHeaderProps) {
  const ToggleIcon =
    side === "left"
      ? isOpen
        ? PanelLeftClose
        : PanelLeftOpen
      : isOpen
        ? PanelRightClose
        : PanelRightOpen;

  return (
    <div
      className={cn(
        "flex min-h-12 shrink-0 items-center gap-2 border-border/80 border-b px-3",
        isOpen ? "justify-end" : "justify-center px-2",
      )}
    >
      <Button
        aria-label={`${isOpen ? "Collapse" : "Expand"} ${label.toLowerCase()} pane`}
        onClick={onToggle}
        size="icon"
        tooltip={`${isOpen ? "Collapse" : "Expand"} ${label.toLowerCase()} pane`}
        type="button"
        variant="ghost"
      >
        <ToggleIcon aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}
