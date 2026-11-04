"use client";

import { AiBox } from "@/components/studio/ai-box/ai-box";
import { ConversationPanel } from "@/components/studio/ai-box/conversation-panel";
import { ChatSessionProvider } from "@/components/studio/ai-box/use-chat-session";
import { CharactersPanel } from "@/components/studio/characters/characters-panel";
import { Manuscript } from "@/components/studio/manuscript/manuscript";
import { WritingLoopProvider } from "@/components/studio/manuscript/use-writing-loop";
import { Outline } from "@/components/studio/outline/outline";
import { OutlineOpenProvider } from "@/components/studio/outline/use-outline-open";
import { VoiceSetupView } from "@/components/studio/voice/voice-setup-view";
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
  voiceSetup?: boolean;
};

function WorkspaceLayout({ voiceSetup }: { voiceSetup: boolean }) {
  const { state } = useStudioStore();
  const { readMode } = state;

  // The plan pane stays mounted while hidden, so the outline's open cards
  // and the AI box survive toggling; focusBundleOp shows it again. The chat
  // session lives above the layout, so a running turn never depends on it.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StudioTopBar />
      {voiceSetup ? (
        <VoiceSetupView storyId={state.story.id} />
      ) : (
        <StudioSplit
          left={<Manuscript />}
          right={
            <PlanPane
              aiBox={<AiBox />}
              characters={<CharactersPanel />}
              conversation={<ConversationPanel />}
              outline={<Outline />}
            />
          }
          rightHidden={readMode}
          storyId={state.story.id}
        />
      )}
    </div>
  );
}

export function StudioWorkspace({
  globalInstructions,
  initial,
  voiceSetup = false,
}: StudioWorkspaceProps) {
  return (
    <StudioStoreProvider initial={{ ...initial, globalInstructions }}>
      {/* One writing loop and one plan AI, shared by manuscript and outline. */}
      <WritingLoopProvider>
        <StoryFleshOutProvider>
          <PlanAiProvider>
            {/* The outline's open item is the AI box's "Looking at". */}
            <OutlineOpenProvider>
              {/* The AI conversation; the manuscript's chat draft sends through it. */}
              <ChatSessionProvider>
                <WorkspaceLayout voiceSetup={voiceSetup} />
              </ChatSessionProvider>
            </OutlineOpenProvider>
          </PlanAiProvider>
        </StoryFleshOutProvider>
      </WritingLoopProvider>
    </StudioStoreProvider>
  );
}
