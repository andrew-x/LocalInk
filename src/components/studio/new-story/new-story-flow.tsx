"use client";

import { useState } from "react";

import { BrainDumpStep } from "./brain-dump-step";
import { GeneratingStep } from "./generating-step";
import { type QuestionAnswer, QuestionsStep } from "./questions-step";

type FlowStory = { id: string; title: string };

type NewStoryFlowProps = {
  resume: FlowStory | null;
};

type FlowStep = "brain-dump" | "questions" | "generating";

export function NewStoryFlow({ resume }: NewStoryFlowProps) {
  const [story, setStory] = useState<FlowStory | null>(resume);
  const [step, setStep] = useState<FlowStep>(
    resume ? "questions" : "brain-dump",
  );
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);

  return (
    <section className="mx-auto w-full max-w-3xl flex-1 py-8">
      {step === "brain-dump" || !story ? (
        <BrainDumpStep
          onCreated={(created) => {
            setStory(created);
            setStep("questions");
          }}
        />
      ) : step === "questions" ? (
        <QuestionsStep
          initialAnswers={answers}
          onContinue={(nextAnswers) => {
            setAnswers(nextAnswers);
            setStep("generating");
          }}
          storyId={story.id}
          title={story.title}
        />
      ) : (
        <GeneratingStep
          answers={answers}
          onCancel={() => setStep("questions")}
          storyId={story.id}
          title={story.title}
        />
      )}
    </section>
  );
}
