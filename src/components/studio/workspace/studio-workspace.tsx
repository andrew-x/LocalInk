"use client";

import {
  ChevronsLeftRight,
  ChevronsRightLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/common/button";
import { BibleSheet } from "@/components/studio/bible/bible-sheet";
import { ChatPanel } from "@/components/studio/chat/chat-panel";
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
import {
  type StudioRightTab,
  StudioStoreProvider,
  useStudioStore,
} from "./use-studio-store";

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
  /** Rendered after the toggle while the pane is open (the right tabs). */
  children?: ReactNode;
};

function PaneToggle({
  isOpen,
  label,
  onToggle,
  side,
  children,
}: PaneToggleProps) {
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
        "flex min-h-10 shrink-0 items-center gap-1 border-border/80 border-b px-2",
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
      {isOpen ? children : null}
    </div>
  );
}

const RIGHT_TABS: { id: StudioRightTab; label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "chat", label: "Chat" },
];

/** Inspect | Chat, with roving focus and automatic activation. */
function RightTabs({
  ids,
  hasPendingBundle,
}: {
  ids: Record<StudioRightTab, { tab: string; panel: string }>;
  hasPendingBundle: boolean;
}) {
  const { state, dispatch } = useStudioStore();
  const tabRefs = useRef(new Map<StudioRightTab, HTMLButtonElement>());

  function activate(tab: StudioRightTab) {
    dispatch({ type: "setRightTab", tab });
    tabRefs.current.get(tab)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = RIGHT_TABS.findIndex((tab) => tab.id === state.rightTab);
    const last = RIGHT_TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    activate(RIGHT_TABS[next].id);
  }

  return (
    <div aria-label="Side panel" className="flex self-stretch" role="tablist">
      {RIGHT_TABS.map((tab) => {
        const selected = state.rightTab === tab.id;
        return (
          <button
            aria-controls={ids[tab.id].panel}
            aria-selected={selected}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 font-semibold text-label-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
              selected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            id={ids[tab.id].tab}
            key={tab.id}
            onClick={() => dispatch({ type: "setRightTab", tab: tab.id })}
            onKeyDown={handleKeyDown}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.id, element);
              else tabRefs.current.delete(tab.id);
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {tab.label}
            {tab.id === "chat" && hasPendingBundle ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-studio-proposed"
                />
                <span className="sr-only">
                  (proposed changes waiting for review)
                </span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function WorkspaceLayout({ inspect }: Pick<StudioWorkspaceProps, "inspect">) {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const [isPlanOpen, setIsPlanOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);
  const [isChatWide, setIsChatWide] = useState(false);
  const { readMode, rightTab } = state;
  const isChat = rightTab === "chat";
  const idBase = useId();
  const tabIds: Record<StudioRightTab, { tab: string; panel: string }> = {
    inspect: { tab: `${idBase}-inspect-tab`, panel: `${idBase}-inspect-panel` },
    chat: { tab: `${idBase}-chat-tab`, panel: `${idBase}-chat-panel` },
  };
  const hasPendingBundle = state.bundles.some((b) => b.status === "pending");

  // "Review in chat" and proposed-row clicks focus a bundle op; the column
  // must be open for its card to show. Layout effect: before the card's
  // scroll, which waits a frame.
  useLayoutEffect(() => {
    if (state.bundleFocusNonce > 0) setIsRightOpen(true);
  }, [state.bundleFocusNonce]);

  const rightWidth = !isRightOpen
    ? "3.5rem"
    : isChat && isChatWide
      ? "min(40rem, 45vw)"
      : "26rem";
  const columnStyle = {
    "--studio-columns": readMode
      ? "minmax(0, 1fr)"
      : `${isPlanOpen ? "20rem" : "3.5rem"} minmax(0, 1fr) ${rightWidth}`,
  } as CSSProperties;
  const wideAction = isChatWide ? "Narrow the chat" : "Widen the chat";

  // Side columns stay mounted in Read mode (hidden) so tree and inspector
  // state survive toggling. The chat panel stays mounted behind Inspect too,
  // so a running turn is not aborted by a tab switch.
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
          aria-label="Inspect and chat"
          className={cn(
            "flex min-h-0 flex-col border-border/80 border-l bg-card/30",
            readMode && "hidden",
          )}
        >
          <PaneToggle
            isOpen={isRightOpen}
            label="Inspect and chat"
            onToggle={() => setIsRightOpen((open) => !open)}
            side="right"
          >
            <RightTabs hasPendingBundle={hasPendingBundle} ids={tabIds} />
            {isChat ? (
              <Button
                aria-label={wideAction}
                aria-pressed={isChatWide}
                className="ml-auto hidden lg:inline-flex"
                onClick={() => setIsChatWide((wide) => !wide)}
                size="icon"
                tooltip={wideAction}
                type="button"
                variant="ghost"
              >
                {isChatWide ? (
                  <ChevronsRightLeft aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronsLeftRight aria-hidden="true" className="size-3.5" />
                )}
              </Button>
            ) : null}
          </PaneToggle>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              !isRightOpen && "hidden",
            )}
          >
            <div
              aria-labelledby={tabIds.inspect.tab}
              className={cn(
                "min-h-0 flex-1 overflow-y-auto",
                isChat && "hidden",
              )}
              hidden={isChat}
              id={tabIds.inspect.panel}
              role="tabpanel"
            >
              {inspect ?? <InspectPanel />}
            </div>
            <div
              aria-labelledby={tabIds.chat.tab}
              className={cn(
                "min-h-0 flex-1 flex-col",
                isChat ? "flex" : "hidden",
              )}
              hidden={!isChat}
              id={tabIds.chat.panel}
              role="tabpanel"
            >
              <ChatPanel active={isChat && isRightOpen && !readMode} />
            </div>
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
