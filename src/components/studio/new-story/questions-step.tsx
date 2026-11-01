"use client";

import { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { postStudioJson } from "@/components/studio/studio-fetch";
import { formResolver } from "@/lib/schemas/resolve";
import type { StudioQuestionsResponse } from "@/lib/studio/planning-contract";

export type QuestionAnswer = {
  questionId: string;
  question: string;
  answer: string;
};

const answersFormSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      question: z.string(),
      why: z.string(),
      answer: z
        .string()
        .max(4000, "Answers must be 4,000 characters or fewer."),
    }),
  ),
});

type AnswersFormValues = z.infer<typeof answersFormSchema>;

type QuestionsStepProps = {
  initialAnswers: QuestionAnswer[];
  onContinue: (answers: QuestionAnswer[]) => void;
  storyId: string;
  title: string;
};

type QuestionsState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; questions: StudioQuestionsResponse["questions"] };

export function QuestionsStep({
  initialAnswers,
  onContinue,
  storyId,
  title,
}: QuestionsStepProps) {
  const [state, setState] = useState<QuestionsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the request when the author retries.
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    postStudioJson<StudioQuestionsResponse>(
      "/api/studio/questions",
      { storyId },
      controller.signal,
    )
      .then((response) => {
        setState({ status: "ready", questions: response.questions });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "The questions could not be loaded.",
        );
        setState({ status: "failed" });
      });

    return () => controller.abort();
  }, [storyId, attempt]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-title">A few questions</h1>
        <p className="mt-1 text-body text-muted-foreground">
          These help shape the plan for {title}. Answer what you like and leave
          the rest blank.
        </p>
      </div>

      {state.status === "loading" ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-border/80 bg-card/45 px-panel py-10 text-center text-body text-muted-foreground"
        >
          Reading your brain dump and thinking of questions...
        </p>
      ) : state.status === "failed" ? (
        <div className="grid gap-4 rounded-lg border border-border/80 bg-card/45 px-panel py-8 text-center">
          <p className="text-body text-muted-foreground">
            The questions could not be loaded. You can try again or continue
            without them.
          </p>
          <div className="flex justify-center gap-2">
            <Button
              onClick={() => setAttempt((value) => value + 1)}
              variant="outline"
            >
              Try again
            </Button>
            <Button onClick={() => onContinue([])}>
              Continue without questions
            </Button>
          </div>
        </div>
      ) : (
        <QuestionsForm
          initialAnswers={initialAnswers}
          onContinue={onContinue}
          questions={state.questions}
        />
      )}
    </div>
  );
}

function QuestionsForm({
  initialAnswers,
  onContinue,
  questions,
}: {
  initialAnswers: QuestionAnswer[];
  onContinue: (answers: QuestionAnswer[]) => void;
  questions: StudioQuestionsResponse["questions"];
}) {
  const form = useForm<AnswersFormValues>({
    defaultValues: {
      answers: questions.map((question) => ({
        answer:
          initialAnswers.find((entry) => entry.questionId === question.id)
            ?.answer ?? "",
        question: question.question,
        questionId: question.id,
        why: question.why,
      })),
    },
    resolver: formResolver(answersFormSchema),
  });

  const submit = useCallback(
    (values: AnswersFormValues) => {
      onContinue(
        values.answers
          .filter((entry) => entry.answer.trim())
          .map(({ answer, question, questionId }) => ({
            answer,
            question: question.slice(0, 1000),
            questionId,
          })),
      );
    },
    [onContinue],
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={form.handleSubmit(submit, () =>
        toast.error("Check the highlighted answers and try again."),
      )}
    >
      {questions.map((question, index) => (
        <Controller
          control={form.control}
          key={question.id}
          name={`answers.${index}.answer`}
          render={({ field, fieldState }) => (
            <div className="grid gap-2">
              <Label htmlFor={`studio-answer-${index}`}>
                {question.question}
              </Label>
              {question.why ? (
                <p className="text-caption text-muted-foreground">
                  {question.why}
                </p>
              ) : null}
              <Textarea
                {...field}
                aria-invalid={fieldState.invalid || undefined}
                autoComplete="off"
                className="min-h-24 font-content"
                id={`studio-answer-${index}`}
                maxLength={4000}
              />
              {fieldState.error ? (
                <p className="text-caption text-destructive">
                  {fieldState.error.message}
                </p>
              ) : null}
            </div>
          )}
        />
      ))}

      <div className="flex justify-end gap-2">
        <Button onClick={() => onContinue([])} type="button" variant="outline">
          Skip all
        </Button>
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}
