"use client";

import { CharactersPanel } from "@/components/studio/characters/characters-panel";
import { ChatPanel } from "@/components/studio/chat/chat-panel";
import { Manuscript } from "@/components/studio/manuscript/manuscript";
import { WritingLoopProvider } from "@/components/studio/manuscript/use-writing-loop";
import { Outline } from "@/components/studio/outline/outline";
import type { StudioWorkspace as StudioWorkspaceData } from "@/lib/studio/contracts";

import { PlanPane } from "./plan-pane";
import { StudioSplit } from "./studio-split";
import { StudioTopBar } from "./studio-top-bar";
import { PlanAiProvider } from "./use-plan-ai";
import { StoryFleshOutProvider } from "./use-story-flesh-out";
import { StudioStoreProvider, useStudioStore } from "./use-studio-store";

type StudioWorkspaceProps = {
  globalInstructions: string;
  initial: StudioWorkspaceData;
};

function WorkspaceLayout() {
  const { state } = useStudioStore();
  const { readMode } = state;

  // "Review in chat" focuses a bundle op; the chat lives in the plan pane,
  // which Read mode hides. focusBundleOp already clears Read mode.
  // The plan pane stays mounted in Read mode (hidden) so the outline's open
  // cards and the chat's running turn survive toggling.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StudioTopBar />
      <StudioSplit
        left={<Manuscript />}
        right={
          <PlanPane
            characters={<CharactersPanel />}
            chat={<ChatPanel active={!readMode} />}
            outline={<Outline />}
          />
        }
        rightHidden={readMode}
        storyId={state.story.id}
      />
    </div>
  );
}

export function StudioWorkspace({
  globalInstructions,
  initial,
}: StudioWorkspaceProps) {
  return (
    <StudioStoreProvider initial={{ ...initial, globalInstructions }}>
      {/* One writing loop and one plan AI, shared by manuscript and outline. */}
      <WritingLoopProvider>
        <StoryFleshOutProvider>
          <PlanAiProvider>
            <WorkspaceLayout />
          </PlanAiProvider>
        </StoryFleshOutProvider>
      </WritingLoopProvider>
    </StudioStoreProvider>
  );
}
