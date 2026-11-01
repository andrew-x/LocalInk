"use client";

import { useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import type { PlanAiController } from "./use-plan-ai";

type AiActionsMenuProps = {
  ai: PlanAiController;
  item: StudioPlanItemDto;
  onDelete: (item: StudioPlanItemDto) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Shown for moments only, and only when a manuscript controller exists. */
  onWrite?: (itemId: string) => void;
  /** Shown for scenes and moments when the writing loop is mounted. */
  onWriteRestOfScene?: (itemId: string, autoKeep: boolean) => void;
};

type View = "menu" | "brief";

const MENU_ITEM_CLASS =
  "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-label-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50";

export function AiActionsMenu({
  ai,
  item,
  onDelete,
  onOpenChange,
  onWrite,
  onWriteRestOfScene,
  open,
}: AiActionsMenuProps) {
  const [view, setView] = useState<View>("menu");
  const [instruction, setInstruction] = useState("");
  const options =
    ai.alternatives?.itemId === item.id
      ? ai.alternatives.preview.options
      : null;
  const isOpen = open || Boolean(options);
  const isBusy = ai.pending.has(item.id);
  const canFleshOut = item.kind !== "moment";

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (options) ai.dismissAlternatives();
      setView("menu");
    }
    onOpenChange(next);
  }

  function runAi(mode: "flesh-out" | "alternatives") {
    handleOpenChange(false);
    ai.start(item.id, mode);
  }

  function submitBrief(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = instruction.trim();
    if (!trimmed) return;
    handleOpenChange(false);
    setInstruction("");
    ai.start(item.id, "rewrite-brief", trimmed);
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`AI actions for ${item.kind}`}
          className={cn(
            "size-6 text-muted-foreground",
            !isOpen &&
              "opacity-0 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100",
          )}
          onClick={(event) => event.stopPropagation()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true">✦</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        // Portaled content still bubbles React events to the tree row.
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {options ? (
          <div className="flex flex-col gap-1">
            <p className="px-2 pt-1 text-caption text-muted-foreground">
              Pick an alternative
            </p>
            {options.map((option, index) => (
              <button
                className={cn(MENU_ITEM_CLASS, "flex-col items-start gap-0.5")}
                key={`${option.title}:${option.whatHappens}`}
                onClick={() => {
                  handleOpenChange(false);
                  ai.applyOption(index);
                }}
                type="button"
              >
                <span className="font-semibold">
                  {option.title || `Option ${index + 1}`}
                </span>
                <span className="line-clamp-3 text-caption text-muted-foreground">
                  {option.whatHappens}
                </span>
              </button>
            ))}
          </div>
        ) : view === "brief" ? (
          <form className="flex flex-col gap-2 p-1" onSubmit={submitBrief}>
            <label
              className="text-caption text-muted-foreground"
              htmlFor={`brief-${item.id}`}
            >
              How should the brief change?
            </label>
            <Input
              autoFocus
              id={`brief-${item.id}`}
              maxLength={2000}
              onChange={(event) => setInstruction(event.target.value)}
              value={instruction}
            />
            <div className="flex justify-end gap-1">
              <Button
                onClick={() => setView("menu")}
                size="sm"
                type="button"
                variant="ghost"
              >
                Back
              </Button>
              <Button disabled={!instruction.trim()} size="sm" type="submit">
                Rewrite
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col">
            {onWrite && item.kind === "moment" ? (
              <button
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  handleOpenChange(false);
                  onWrite(item.id);
                }}
                type="button"
              >
                Write
              </button>
            ) : null}
            {onWriteRestOfScene && item.kind !== "chapter" ? (
              <>
                <button
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    handleOpenChange(false);
                    onWriteRestOfScene(item.id, false);
                  }}
                  type="button"
                >
                  Write rest of scene
                </button>
                <button
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    handleOpenChange(false);
                    onWriteRestOfScene(item.id, true);
                  }}
                  type="button"
                >
                  Write rest of scene, keep as they come
                </button>
              </>
            ) : null}
            {canFleshOut ? (
              <button
                className={MENU_ITEM_CLASS}
                disabled={isBusy}
                onClick={() => runAi("flesh-out")}
                type="button"
              >
                {item.kind === "chapter"
                  ? "Flesh out into scenes"
                  : "Flesh out into moments"}
              </button>
            ) : null}
            <button
              className={MENU_ITEM_CLASS}
              disabled={isBusy}
              onClick={() => runAi("alternatives")}
              type="button"
            >
              3 alternatives
            </button>
            <button
              className={MENU_ITEM_CLASS}
              disabled={isBusy}
              onClick={() => setView("brief")}
              type="button"
            >
              Rewrite brief
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className={cn(MENU_ITEM_CLASS, "text-destructive")}
              onClick={() => {
                handleOpenChange(false);
                onDelete(item);
              }}
              type="button"
            >
              Delete
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
