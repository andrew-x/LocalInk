"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Button } from "@/components/common/button";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { isStudioVoiceSetUp } from "@/lib/studio/voice";

import { useStartVoiceSetup } from "./use-start-voice-setup";
import { VoicePanel } from "./voice-panel";

type VoiceSetupViewProps = { storyId: string };

/** The Voice step shown after a new story's plan is built. */
export function VoiceSetupView({ storyId }: VoiceSetupViewProps) {
  const router = useRouter();
  const { state } = useStudioStore();
  const { start, running, failed } = useStartVoiceSetup();
  const setUp = isStudioVoiceSetUp(state.story);
  const started = useRef(false);

  // The ref keeps StrictMode's double effect from asking twice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `start` is intentionally called once on mount.
  useEffect(() => {
    if (started.current || setUp) return;
    started.current = true;
    void start();
  }, []);

  const leave = () => router.replace(`/studio/${storyId}`);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8">
        <div>
          <h1 className="font-serif text-title">Hear the voice</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Pick what sounds right. Change a pick and the sample changes with
            it.
          </p>
        </div>
        {setUp ? (
          <VoicePanel
            footer={
              <div className="flex justify-end gap-2">
                <Button onClick={leave} variant="outline">
                  Skip for now
                </Button>
                <Button onClick={leave}>Keep voice · Start writing</Button>
              </div>
            }
            layout="wide"
          />
        ) : failed && !running ? (
          <div className="flex items-center gap-3">
            <p className="text-body text-muted-foreground">
              Couldn't get the questions.
            </p>
            <Button onClick={() => void start()} variant="outline">
              Retry
            </Button>
            <Button onClick={leave} variant="ghost">
              Skip for now
            </Button>
          </div>
        ) : (
          <div
            aria-live="polite"
            className="flex items-center gap-2 text-body text-muted-foreground"
          >
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Getting a few questions ready…
          </div>
        )}
      </div>
    </div>
  );
}
