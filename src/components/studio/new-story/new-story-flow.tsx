"use client";

import { useCallback, useState } from "react";

import type { StudioQuestionsResponse } from "@/lib/studio/planning-contract";

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
  // Questions and typed answers live here so returning from generation neither
  // refetches (another model call) nor drops what the author wrote.
  const [questions, setQuestions] = useState<
    StudioQuestionsResponse["questions"] | null
  >(null);
  const [questionsFailed, setQuestionsFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const handleLoaded = useCallback(
    (loaded: StudioQuestionsResponse["questions"]) => setQuestions(loaded),
    [],
  );
  const handleFailed = useCallback(() => setQuestionsFailed(true), []);

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
          drafts={drafts}
          failed={questionsFailed}
          onDraftsChange={setDrafts}
          onFailed={handleFailed}
          onLoaded={handleLoaded}
          onRetry={() => setQuestionsFailed(false)}
          questions={questions}
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
