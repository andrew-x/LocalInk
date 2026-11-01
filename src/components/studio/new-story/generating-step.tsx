"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { applyStudioPlan } from "@/actions/studio/apply-studio-plan";
import { Button } from "@/components/common/button";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import type { StudioPlanPreview } from "@/lib/studio/planning-contract";

import type { QuestionAnswer } from "./questions-step";

type GeneratingStepProps = {
  answers: QuestionAnswer[];
  onCancel: () => void;
  storyId: string;
  title: string;
};

type Phase = "planning" | "applying" | "failed";

const APPLY_FAILED_MESSAGE = "The plan could not be saved. Please try again.";
const GENERATE_FAILED_MESSAGE = "The plan could not be generated.";

export function GeneratingStep({
  answers,
  onCancel,
  storyId,
  title,
}: GeneratingStepProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("planning");
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request when the author retries.
  useEffect(() => {
    const controller = new AbortController();
    setPhase("planning");

    async function run() {
      let message: string | null = null;
      try {
        const preview = await postStudioJson<StudioPlanPreview>(
          "/api/studio/plan",
          { answers, mode: "initial", storyId },
          controller.signal,
        );
        if (controller.signal.aborted) return;

        setPhase("applying");
        const result = await applyStudioPlan({
          generationId: preview.generationId,
          mode: "initial",
          storyId,
        });
        if (controller.signal.aborted) return;

        if (result.data) {
          router.push(`/studio/${result.data.story.id}`);
          return;
        }
        message =
          result.serverError?.message ??
          result.validationErrors?.formErrors[0] ??
          APPLY_FAILED_MESSAGE;
      } catch (error) {
        if (controller.signal.aborted) return;
        message = studioErrorMessage(error, GENERATE_FAILED_MESSAGE);
      }

      toast.error(message);
      setPhase("failed");
    }

    void run();

    return () => controller.abort();
  }, [answers, storyId, router, attempt]);

  if (phase === "failed") {
    return (
      <div className="grid gap-6">
        <div>
          <h1 className="font-serif text-title">The plan did not finish</h1>
          <p className="mt-1 text-body text-muted-foreground">
            {title} is saved as a draft. Nothing was lost, and you can try
            again.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
          <Button onClick={onCancel} variant="outline">
            Back to questions
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-6 py-16 text-center">
      <LoaderCircle
        aria-hidden="true"
        className="size-8 animate-spin text-muted-foreground"
      />
      <div aria-live="polite">
        <h1 className="font-serif text-title">
          {phase === "planning"
            ? "Shaping your plan"
            : "Setting up your workspace"}
        </h1>
        <p className="mt-1 text-body text-muted-foreground">
          {phase === "planning"
            ? "Drafting chapters, scenes and Bible entries for " +
              title +
              ". This can take a minute."
            : "Almost there."}
        </p>
      </div>
      {phase === "planning" ? (
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
