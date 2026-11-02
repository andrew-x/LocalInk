"use client";

import type { ReactNode } from "react";

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

import { PlanPane } from "./plan-pane";
import { PlanTree } from "./plan-tree";
import { StudioSplit } from "./studio-split";
import { StudioTopBar } from "./studio-top-bar";
import { StoryFleshOutProvider } from "./use-story-flesh-out";
import { StudioStoreProvider, useStudioStore } from "./use-studio-store";

type StudioWorkspaceProps = {
  globalInstructions: string;
  initial: StudioWorkspaceData;
  /** Overrides the default Inspect panel. */
  inspect?: ReactNode;
};

function WorkspaceLayout({ inspect }: Pick<StudioWorkspaceProps, "inspect">) {
  const { state, dispatch } = useStudioStore();
  const loop = useWritingLoop();
  const { readMode } = state;

  // "Review in chat" focuses a bundle op; the chat lives in the plan pane,
  // which Read mode hides. focusBundleOp already clears Read mode.
  // Side panes stay mounted in Read mode (hidden) so tree, inspector and the
  // chat's running turn survive toggling.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <StudioTopBar />
      <StudioSplit
        left={<Manuscript />}
        right={
          <PlanPane
            characters={
              <div className="flex flex-col items-start gap-3 p-4">
                {/* Temporary until Task 5 replaces the Bible sheet. */}
                <p className="text-body text-muted-foreground">
                  Characters and places are still in the Story Bible for now.
                </p>
                <Button
                  onClick={() =>
                    dispatch({ type: "openBible", section: "overview" })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Open the Bible
                </Button>
              </div>
            }
            chat={<ChatPanel active={!readMode} />}
            outline={
              <>
                {/* Temporary until Task 4 replaces the tree and Inspect. */}
                <div className="flex max-h-[55%] min-h-0 flex-col border-border/80 border-b">
                  <PlanTree
                    onWrite={(itemId) => void loop.write(itemId)}
                    onWriteRestOfScene={(itemId, autoKeep) =>
                      void loop.writeRestOfScene(itemId, autoKeep)
                    }
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {inspect ?? <InspectPanel />}
                </div>
              </>
            }
          />
        }
        rightHidden={readMode}
        storyId={state.story.id}
      />
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
