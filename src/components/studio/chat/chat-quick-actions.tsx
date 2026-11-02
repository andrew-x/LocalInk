"use client";

import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/common/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { chapterNumbers } from "@/components/studio/shared/inspect-labels";
import {
  useSelectedItem,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { getAncestors } from "@/lib/studio/plan-order";

type QuickAction = {
  id: string;
  label: string;
  /** The text to insert, or null when the selection does not fit. */
  prompt: string | null;
  hint?: string;
};

const NEEDS_CHAPTER = "Select a chapter, scene, or moment first.";
const NEEDS_SCENE = "Select a scene or one of its moments first.";

function quoted(title: string): string {
  return `“${title.trim()}”`;
}

/** The five quick actions, scoped by the current selection. */
function useQuickActions(pinnedEntryIds: string[]): QuickAction[] {
  const { state } = useStudioStore();
  const selected = useSelectedItem();
  const { entries, planItems } = state;

  return useMemo(() => {
    const chain = selected
      ? [...getAncestors(planItems, selected.id), selected]
      : [];
    const chapter = chain.find((item) => item.kind === "chapter") ?? null;
    const scene = chain.find((item) => item.kind === "scene") ?? null;
    const number = chapter ? chapterNumbers(planItems).get(chapter.id) : null;
    const chapterName = number ? `Chapter ${number}` : "this chapter";
    const chapterRef = chapter
      ? chapterName +
        (chapter.title.trim() ? ` (${quoted(chapter.title)})` : "")
      : null;
    const sceneRef = scene
      ? (scene.title.trim()
          ? `the scene ${quoted(scene.title)}`
          : "this scene") + (number ? ` in Chapter ${number}` : "")
      : null;
    // Ruling A7: the first pinned entry, else a stub the author finishes.
    const firstPinned = pinnedEntryIds
      .map((id) => entries.find((entry) => entry.id === id))
      .find((entry) => entry !== undefined);
    const pinnedName = firstPinned?.name.trim() || null;

    return [
      {
        id: "plan-next-chapter",
        label: "Plan the next chapter",
        prompt: "Plan the next chapter.",
      },
      {
        id: "flesh-out-scenes",
        label: "Flesh out scenes for this chapter",
        prompt: chapterRef ? `Flesh out the scenes for ${chapterRef}.` : null,
        hint: NEEDS_CHAPTER,
      },
      {
        id: "write-rest-of-scene",
        label: "Write the rest of this scene",
        prompt: sceneRef ? `Write the rest of ${sceneRef}.` : null,
        hint: NEEDS_SCENE,
      },
      {
        id: "check-continuity",
        label: "Check continuity in this chapter",
        prompt: chapterRef
          ? `Check continuity in ${chapterRef}. Report what you find; don't change anything yet.`
          : null,
        hint: NEEDS_CHAPTER,
      },
      {
        id: "suggest-tracking",
        label: pinnedName
          ? `Suggest what to track for ${pinnedName}`
          : "Suggest what to track for…",
        prompt: pinnedName
          ? `Suggest what to track for ${pinnedName}.`
          : "Suggest what to track for ",
      },
    ];
  }, [entries, pinnedEntryIds, planItems, selected]);
}

type ChatQuickActionsProps = {
  pinnedEntryIds: string[];
  disabled: boolean;
  onInsert: (prompt: string) => void;
  /** `list` for an empty thread; `menu` (a popover) under the messages. */
  layout: "list" | "menu";
};

/** Prompts the author can drop into the composer and edit before sending. */
export function ChatQuickActions({
  pinnedEntryIds,
  disabled,
  onInsert,
  layout,
}: ChatQuickActionsProps) {
  const actions = useQuickActions(pinnedEntryIds);
  const [open, setOpen] = useState(false);

  const items = (
    <ul className="flex flex-col gap-0.5">
      {actions.map((action) => (
        <li key={action.id}>
          <button
            className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-label-sm outline-none hover:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled || action.prompt === null}
            onClick={() => {
              if (action.prompt === null) return;
              onInsert(action.prompt);
              setOpen(false);
            }}
            type="button"
          >
            <span>{action.label}</span>
            {action.prompt === null && action.hint ? (
              <span className="text-caption text-muted-foreground">
                {action.hint}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );

  if (layout === "list") {
    return (
      <div className="flex flex-col gap-1">
        <h3 className="px-2 font-semibold text-caption text-muted-foreground uppercase tracking-wide">
          Quick actions
        </h3>
        {items}
      </div>
    );
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="h-6 gap-1 px-2 text-caption text-muted-foreground"
          disabled={disabled}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Sparkles aria-hidden="true" className="size-3" />
          Quick actions
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1" side="top">
        {items}
      </PopoverContent>
    </Popover>
  );
}
