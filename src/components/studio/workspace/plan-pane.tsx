"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

import { VoicePanel } from "@/components/studio/voice/voice-panel";
import { cn } from "@/lib/util";

import { type StudioPlanTab, useStudioStore } from "./use-studio-store";

const PLAN_TABS: { id: StudioPlanTab; label: string }[] = [
  { id: "outline", label: "Outline" },
  { id: "characters", label: "Characters & places" },
  { id: "voice", label: "Voice" },
];

type PlanPaneProps = {
  outline: ReactNode;
  characters: ReactNode;
  /** The AI box, docked under both tabs. */
  aiBox: ReactNode;
  /** The conversation overlay; it positions itself over the tab panels. */
  conversation: ReactNode;
};

/**
 * Outline | Characters & places | Voice tabs over the plan, with the AI box docked
 * at the bottom and the conversation opening over the tabs. The outline and characters
 * panels stay mounted (hidden) so their state survives, and the whole pane stays
 * mounted while the plan is hidden.
 */
export function PlanPane({
  outline,
  characters,
  aiBox,
  conversation,
}: PlanPaneProps) {
  const { state, dispatch } = useStudioStore();
  const idBase = useId();
  const tabRefs = useRef(new Map<StudioPlanTab, HTMLButtonElement>());
  const { planTab } = state;
  const ids: Record<StudioPlanTab, { tab: string; panel: string }> = {
    outline: { tab: `${idBase}-outline-tab`, panel: `${idBase}-outline-panel` },
    characters: {
      tab: `${idBase}-characters-tab`,
      panel: `${idBase}-characters-panel`,
    },
    voice: { tab: `${idBase}-voice-tab`, panel: `${idBase}-voice-panel` },
  };

  function activate(tab: StudioPlanTab) {
    dispatch({ type: "setPlanTab", tab });
    tabRefs.current.get(tab)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = PLAN_TABS.findIndex((tab) => tab.id === planTab);
    const last = PLAN_TABS.length - 1;
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
    activate(PLAN_TABS[next].id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-label="Plan"
          className="flex min-h-10 shrink-0 items-stretch gap-1 border-border/80 border-b px-2"
          role="tablist"
        >
          {PLAN_TABS.map((tab) => {
            const selected = planTab === tab.id;
            return (
              <button
                aria-controls={ids[tab.id].panel}
                aria-selected={selected}
                className={cn(
                  "-mb-px flex items-center border-b-2 px-2.5 font-semibold text-label-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                  selected
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                id={ids[tab.id].tab}
                key={tab.id}
                onClick={() => dispatch({ type: "setPlanTab", tab: tab.id })}
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
              </button>
            );
          })}
        </div>
        <div
          aria-labelledby={ids.outline.tab}
          className={cn(
            "min-h-0 flex-1 flex-col",
            planTab === "outline" ? "flex" : "hidden",
          )}
          hidden={planTab !== "outline"}
          id={ids.outline.panel}
          role="tabpanel"
        >
          {outline}
        </div>
        <div
          aria-labelledby={ids.characters.tab}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            planTab === "characters" ? "flex" : "hidden",
          )}
          hidden={planTab !== "characters"}
          id={ids.characters.panel}
          role="tabpanel"
        >
          {characters}
        </div>
        <div
          aria-labelledby={ids.voice.tab}
          className={cn(
            "min-h-0 flex-1 flex-col overflow-y-auto",
            planTab === "voice" ? "flex" : "hidden",
          )}
          hidden={planTab !== "voice"}
          id={ids.voice.panel}
          role="tabpanel"
        >
          {/* Mounted only while shown: opening it writes samples, so a hidden
              panel must not. Unkept drafts are dropped when it closes. */}
          {planTab === "voice" ? <VoicePanel layout="stacked" /> : null}
        </div>
        {conversation}
      </div>
      {aiBox}
    </div>
  );
}
