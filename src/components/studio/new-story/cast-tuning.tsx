"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { SectionHeading } from "@/components/studio/characters/section-heading";
import { cancelAutoDetails } from "@/components/studio/characters/use-auto-details";
import {
  useApplyCastRevision,
  waitForEntrySaves,
} from "@/components/studio/characters/use-patch-entry";
import { PlainText } from "@/components/studio/outline/plain-text";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { formResolver } from "@/lib/schemas/resolve";
import {
  STUDIO_CAST_NUDGE_MAX_CHARS,
  type StudioCastInstruction,
  type StudioCastPick,
  type StudioCastPicksResponse,
  type StudioCastRevisePreview,
} from "@/lib/studio/cast-contract";
import type { StudioEntryDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

const REVISE_FAILED_MESSAGE = "The revision could not be finished.";
const PICKS_FAILED_MESSAGE = "Couldn't get more questions.";
const ASKED_LIMIT = 30;

const CHARACTER_COPY = {
  pronoun: "them",
  placeholder: "Or say what to change: older, warmer, secretly broke…",
};
const PLACE_COPY = {
  pronoun: "it",
  placeholder: "Or say what to change: shabbier, by the water, closes at dusk…",
};

const nudgeFormSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Say what to change.")
    .max(
      STUDIO_CAST_NUDGE_MAX_CHARS,
      `Keep it to ${STUDIO_CAST_NUDGE_MAX_CHARS.toLocaleString()} characters or fewer.`,
    ),
});

type NudgeFormValues = z.infer<typeof nudgeFormSchema>;

export type CastTuningState = {
  picks: StudioCastPick[];
  /** Every question offered so far, so "Ask me more" never repeats one. */
  asked: string[];
};

type CastTuningProps = {
  entry: StudioEntryDto;
  tuning: CastTuningState;
  onTuningChange: (tuning: CastTuningState) => void;
  onBusyChange: (busy: boolean) => void;
};

/**
 * Shapes one character or place: the AI's questions about what the brain
 * dump leaves open, and a free-text request. Either one revises the entry's
 * AI-owned details, and its paragraph while that is still the AI's draft.
 */
export function CastTuning({
  entry,
  onBusyChange,
  onTuningChange,
  tuning,
}: CastTuningProps) {
  const { state } = useStudioStore();
  const storyId = state.story.id;
  const applyRevision = useApplyCastRevision();
  const [busy, setBusyState] = useState<"revise" | "picks" | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const form = useForm<NudgeFormValues>({
    defaultValues: { text: "" },
    resolver: formResolver(nudgeFormSchema),
  });
  const rootError = form.formState.errors.root?.message;
  const textError = form.formState.errors.text?.message;

  function setBusy(next: "revise" | "picks" | null) {
    setBusyState(next);
    onBusyChange(next !== null);
  }

  /** Resolves null on success, else the message to show (already toasted). */
  async function revise(
    instruction: StudioCastInstruction,
  ): Promise<string | null> {
    setBusy("revise");
    try {
      // A blur just before the click queues a save; the AI must read it. That
      // save may schedule a details refresh, which would make this revision
      // stale, and the revision rewrites the details anyway.
      await waitForEntrySaves(storyId, entry.id);
      cancelAutoDetails(storyId, entry.id);
      const preview = await postStudioJson<StudioCastRevisePreview>(
        "/api/studio/cast/revise",
        { storyId, entryId: entry.id, instruction },
      );
      const result = await applyRevision(entry.id, preview.generationId);
      if (!result) return REVISE_FAILED_MESSAGE;
      if (result.stale) {
        const message = `${entry.name} changed while the AI was revising. Try again.`;
        toast.error(message);
        return message;
      }
      return null;
    } catch (error) {
      const message = studioErrorMessage(error, REVISE_FAILED_MESSAGE);
      toast.error(message);
      return message;
    } finally {
      setBusy(null);
    }
  }

  async function choose(pick: StudioCastPick, optionId: string) {
    const option = pick.options.find((item) => item.id === optionId);
    if (!option) return;
    setChoosing(optionId);
    const failed = await revise({
      kind: "pick",
      question: pick.question,
      choice: option.hint ? `${option.label}: ${option.hint}` : option.label,
    });
    setChoosing(null);
    if (failed) return;
    onTuningChange({
      ...tuning,
      picks: tuning.picks.filter((item) => item.id !== pick.id),
    });
  }

  async function askMore() {
    setBusy("picks");
    try {
      const response = await postStudioJson<StudioCastPicksResponse>(
        "/api/studio/cast/picks",
        {
          storyId,
          entryId: entry.id,
          asked: tuning.asked.slice(-ASKED_LIMIT),
        },
      );
      if (response.picks.length === 0) {
        toast(`Nothing more to ask about ${copy.pronoun} right now.`);
        return;
      }
      onTuningChange({
        picks: [...tuning.picks, ...response.picks],
        asked: [
          ...tuning.asked,
          ...response.picks.map((pick) => pick.question),
        ],
      });
    } catch (error) {
      toast.error(studioErrorMessage(error, PICKS_FAILED_MESSAGE));
    } finally {
      setBusy(null);
    }
  }

  async function submitNudge(values: NudgeFormValues) {
    form.clearErrors("root");
    const failed = await revise({ kind: "nudge", text: values.text });
    if (failed) form.setError("root", { message: failed });
    else form.reset({ text: "" });
  }

  const onNudgeSubmit = form.handleSubmit(submitNudge, () =>
    toast.error("Check what you asked for and try again."),
  );

  const disabled = busy !== null;
  const copy = entry.type === "place" ? PLACE_COPY : CHARACTER_COPY;

  return (
    <section
      aria-busy={disabled || undefined}
      aria-label={`Shape ${entry.name}`}
      className="flex flex-col gap-3 rounded-md bg-muted/30 px-2.5 py-2"
    >
      <SectionHeading>Shape {copy.pronoun}</SectionHeading>

      {tuning.picks.map((pick) => (
        <fieldset className="flex flex-col gap-1" key={pick.id}>
          <legend className="mb-1 text-label-sm">{pick.question}</legend>
          <div className="flex flex-col gap-1">
            {pick.options.map((option) => (
              <button
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border border-border/70 bg-background px-2 py-1.5 text-left text-label-sm outline-none transition-colors hover:border-ring/50 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-60",
                  choosing === option.id && "border-accent/60",
                )}
                disabled={disabled}
                key={option.id}
                onClick={() => void choose(pick, option.id)}
                type="button"
              >
                {choosing === option.id ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="mt-0.5 size-3.5 shrink-0 animate-spin"
                  />
                ) : null}
                <span className="min-w-0">
                  <span className="font-medium">{option.label}</span>
                  {option.hint ? (
                    <span className="block text-caption text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      <Button
        className="h-7 self-start px-2 text-caption"
        disabled={disabled}
        loading={busy === "picks"}
        onClick={() => void askMore()}
        size="sm"
        type="button"
        variant="ghost"
      >
        {tuning.picks.length > 0
          ? "Ask me more"
          : `Ask me about ${copy.pronoun}`}
      </Button>

      <form className="flex flex-col gap-1" onSubmit={onNudgeSubmit}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1.5">
            <PlainText
              {...form.register("text")}
              aria-describedby={
                textError || rootError ? `${entry.id}-nudge-error` : undefined
              }
              aria-invalid={Boolean(textError) || undefined}
              disabled={disabled}
              label={`What to change about ${entry.name}`}
              maxLength={STUDIO_CAST_NUDGE_MAX_CHARS}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void onNudgeSubmit();
                }
              }}
              placeholder={copy.placeholder}
            />
          </div>
          <Button
            disabled={disabled}
            loading={busy === "revise" && choosing === null}
            size="sm"
            type="submit"
            variant="outline"
          >
            Revise
          </Button>
        </div>
        {textError || rootError ? (
          <p
            className="text-caption text-destructive"
            id={`${entry.id}-nudge-error`}
          >
            {textError ?? rootError}
          </p>
        ) : null}
      </form>

      {busy === "revise" ? (
        <p aria-live="polite" className="text-caption text-muted-foreground">
          Revising {entry.name}…
        </p>
      ) : null}
    </section>
  );
}
