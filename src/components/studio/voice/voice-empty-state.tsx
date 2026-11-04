"use client";

import { Button } from "@/components/common/button";

import { useStartVoiceSetup } from "./use-start-voice-setup";

/** A story with no voice yet: one button that asks for the first questions. */
export function VoiceEmptyState() {
  const { start, running, failed } = useStartVoiceSetup();
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6">
      <h2 className="font-serif text-heading">Set how this story sounds.</h2>
      <p className="text-body text-muted-foreground">
        A few questions, then a short sample of the voice to react to.
      </p>
      <Button loading={running} onClick={() => void start()} type="button">
        Hear the voice
      </Button>
      {failed && !running ? (
        <p className="text-caption text-muted-foreground">
          Nothing was set. You can try again.
        </p>
      ) : null}
    </div>
  );
}
