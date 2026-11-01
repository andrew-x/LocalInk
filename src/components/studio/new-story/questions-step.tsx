"use client";

import { useCallback, useEffect } from "react";
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

type StudioQuestion = StudioQuestionsResponse["questions"][number];

type QuestionsStepProps = {
  drafts: Record<string, string>;
  failed: boolean;
  onContinue: (answers: QuestionAnswer[]) => void;
  onDraftsChange: (drafts: Record<string, string>) => void;
  onFailed: () => void;
  onLoaded: (questions: StudioQuestion[]) => void;
  onRetry: () => void;
  questions: StudioQuestion[] | null;
  storyId: string;
  title: string;
};

export function QuestionsStep({
  drafts,
  failed,
  onContinue,
  onDraftsChange,
  onFailed,
  onLoaded,
  onRetry,
  questions,
  storyId,
  title,
}: QuestionsStepProps) {
  const needsFetch = questions === null && !failed;

  useEffect(() => {
    if (!needsFetch) return;
    const controller = new AbortController();

    postStudioJson<StudioQuestionsResponse>(
      "/api/studio/questions",
      { storyId },
      controller.signal,
    )
      .then((response) => onLoaded(response.questions))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "The questions could not be loaded.",
        );
        onFailed();
      });

    return () => controller.abort();
  }, [needsFetch, storyId, onLoaded, onFailed]);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-title">A few questions</h1>
        <p className="mt-1 text-body text-muted-foreground">
          These help shape the plan for {title}. Answer what you like and leave
          the rest blank.
        </p>
      </div>

      {questions ? (
        <QuestionsForm
          drafts={drafts}
          onContinue={onContinue}
          onDraftsChange={onDraftsChange}
          questions={questions}
        />
      ) : failed ? (
        <div className="grid gap-4 rounded-lg border border-border/80 bg-card/45 px-panel py-8 text-center">
          <p className="text-body text-muted-foreground">
            The questions could not be loaded. You can try again or continue
            without them.
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={onRetry} variant="outline">
              Try again
            </Button>
            <Button onClick={() => onContinue([])}>
              Continue without questions
            </Button>
          </div>
        </div>
      ) : (
        <p
          aria-live="polite"
          className="rounded-lg border border-border/80 bg-card/45 px-panel py-10 text-center text-body text-muted-foreground"
        >
          Reading your brain dump and thinking of questions...
        </p>
      )}
    </div>
  );
}

function QuestionsForm({
  drafts,
  onContinue,
  onDraftsChange,
  questions,
}: {
  drafts: Record<string, string>;
  onContinue: (answers: QuestionAnswer[]) => void;
  onDraftsChange: (drafts: Record<string, string>) => void;
  questions: StudioQuestion[];
}) {
  const form = useForm<AnswersFormValues>({
    defaultValues: {
      answers: questions.map((question) => ({
        answer: drafts[question.id] ?? "",
        question: question.question,
        questionId: question.id,
        why: question.why,
      })),
    },
    resolver: formResolver(answersFormSchema),
  });

  useEffect(() => {
    const subscription = form.watch((values) => {
      const next: Record<string, string> = {};
      for (const entry of values.answers ?? []) {
        if (entry?.questionId) next[entry.questionId] = entry.answer ?? "";
      }
      onDraftsChange(next);
    });
    return () => subscription.unsubscribe();
  }, [form, onDraftsChange]);

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
                aria-describedby={
                  fieldState.error ? `studio-answer-${index}-error` : undefined
                }
                aria-invalid={fieldState.invalid || undefined}
                autoComplete="off"
                className="min-h-24 font-content"
                id={`studio-answer-${index}`}
                maxLength={4000}
              />
              {fieldState.error ? (
                <p
                  className="text-caption text-destructive"
                  id={`studio-answer-${index}-error`}
                >
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
