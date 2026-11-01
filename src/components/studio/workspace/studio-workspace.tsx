"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { Button } from "@/components/common/button";
import { BibleSheet } from "@/components/studio/bible/bible-sheet";
import { InspectPanel } from "@/components/studio/inspect/inspect-panel";
import { Manuscript } from "@/components/studio/manuscript/manuscript";
import {
  useWritingLoop,
  WritingLoopProvider,
} from "@/components/studio/manuscript/use-writing-loop";
import type { StudioWorkspace as StudioWorkspaceData } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { PlanTree } from "./plan-tree";
import { StudioTopBar } from "./studio-top-bar";
import { StoryFleshOutProvider } from "./use-story-flesh-out";
import { StudioStoreProvider, useStudioStore } from "./use-studio-store";

type StudioWorkspaceProps = {
  globalInstructions: string;
  initial: StudioWorkspaceData;
  /** Overrides the default Inspect panel. */
  inspect?: ReactNode;
};

type PaneToggleProps = {
  isOpen: boolean;
  label: string;
  onToggle: () => void;
  side: "left" | "right";
};

function PaneToggle({ isOpen, label, onToggle, side }: PaneToggleProps) {
  const Icon =
    side === "left"
      ? isOpen
        ? PanelLeftClose
        : PanelLeftOpen
      : isOpen
        ? PanelRightClose
        : PanelRightOpen;
  const action = `${isOpen ? "Collapse" : "Expand"} ${label.toLowerCase()} pane`;

  return (
    <div
      className={cn(
        "flex min-h-10 shrink-0 items-center border-border/80 border-b px-2",
        isOpen
          ? side === "left"
            ? "justify-end"
            : "justify-start"
          : "justify-center",
      )}
    >
      <Button
        aria-label={action}
        onClick={onToggle}
        size="icon"
        tooltip={action}
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}

function WorkspaceLayout({ inspect }: Pick<StudioWorkspaceProps, "inspect">) {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const [isPlanOpen, setIsPlanOpen] = useState(true);
  const [isInspectOpen, setIsInspectOpen] = useState(true);
  const { readMode } = state;

  const columnStyle = {
    "--studio-columns": readMode
      ? "minmax(0, 1fr)"
      : `${isPlanOpen ? "20rem" : "3.5rem"} minmax(0, 1fr) ${
          isInspectOpen ? "26rem" : "3.5rem"
        }`,
  } as CSSProperties;

  // Side columns stay mounted in Read mode (hidden) so tree and inspector
  // state survive toggling.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StudioTopBar />
      <div
        className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[var(--studio-columns)]"
        style={columnStyle}
      >
        <aside
          aria-label="Plan"
          className={cn(
            "flex min-h-0 flex-col border-border/80 border-r bg-card/30",
            readMode && "hidden",
          )}
        >
          <PaneToggle
            isOpen={isPlanOpen}
            label="Plan"
            onToggle={() => setIsPlanOpen((open) => !open)}
            side="left"
          />
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              !isPlanOpen && "hidden",
            )}
          >
            <PlanTree
              onWrite={(itemId) => void loop.write(itemId)}
              onWriteRestOfScene={(itemId, autoKeep) =>
                void loop.writeRestOfScene(itemId, autoKeep)
              }
            />
          </div>
        </aside>

        {/* The manuscript caps its own measure in its content font. */}
        <section aria-label="Manuscript" className="min-h-0 overflow-y-auto">
          <Manuscript />
        </section>

        <aside
          aria-label="Inspect"
          className={cn(
            "flex min-h-0 flex-col border-border/80 border-l bg-card/30",
            readMode && "hidden",
          )}
        >
          <PaneToggle
            isOpen={isInspectOpen}
            label="Inspect"
            onToggle={() => setIsInspectOpen((open) => !open)}
            side="right"
          />
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              !isInspectOpen && "hidden",
            )}
          >
            {inspect ?? <InspectPanel />}
          </div>
        </aside>
      </div>
      <BibleSheet />
    </div>
  );
}

export function StudioWorkspace({
  globalInstructions,
  initial,
  inspect,
}: StudioWorkspaceProps) {
  return (
    <StudioStoreProvider initial={{ ...initial, globalInstructions }}>
      {/* One writing loop shared by the manuscript, the tree and Inspect. */}
      <WritingLoopProvider>
        <StoryFleshOutProvider>
          <WorkspaceLayout inspect={inspect} />
        </StoryFleshOutProvider>
      </WritingLoopProvider>
    </StudioStoreProvider>
  );
}
