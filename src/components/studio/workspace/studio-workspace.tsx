"use client";

import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";

import { Button } from "@/components/common/button";
import type { StudioWorkspace as StudioWorkspaceData } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { PlanTree } from "./plan-tree";
import { StudioTopBar } from "./studio-top-bar";
import { StudioStoreProvider, useStudioStore } from "./use-studio-store";
import { InspectSlot, ManuscriptSlot } from "./workspace-slots";

type StudioWorkspaceProps = {
  globalInstructions: string;
  initial: StudioWorkspaceData;
  /** Task 12 fills the right column. */
  inspect?: ReactNode;
  /** Task 11 fills the center column. */
  manuscript?: ReactNode;
  /** Task 11's writing loop; the tree's "Write" item appears only when set. */
  onWriteMoment?: (itemId: string) => void;
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

function WorkspaceLayout({
  inspect,
  manuscript,
  onWriteMoment,
}: Pick<StudioWorkspaceProps, "inspect" | "manuscript" | "onWriteMoment">) {
  const { state } = useStudioStore();
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
            <PlanTree onWrite={onWriteMoment} />
          </div>
        </aside>

        <section aria-label="Manuscript" className="min-h-0 overflow-y-auto">
          <div className={cn(readMode && "mx-auto max-w-[70ch]")}>
            {manuscript ?? <ManuscriptSlot />}
          </div>
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
            {inspect ?? <InspectSlot />}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function StudioWorkspace({
  globalInstructions,
  initial,
  inspect,
  manuscript,
  onWriteMoment,
}: StudioWorkspaceProps) {
  return (
    <StudioStoreProvider initial={{ ...initial, globalInstructions }}>
      <WorkspaceLayout
        inspect={inspect}
        manuscript={manuscript}
        onWriteMoment={onWriteMoment}
      />
    </StudioStoreProvider>
  );
}
