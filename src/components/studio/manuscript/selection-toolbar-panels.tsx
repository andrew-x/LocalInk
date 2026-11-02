"use client";

import type { RangeSelection } from "lexical";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { formResolver } from "@/lib/schemas/resolve";
import {
  STUDIO_REWRITE_MAX_INSTRUCTION_CHARS,
  type StudioRewriteMode,
} from "@/lib/studio/rewrite-contract";

export type CapturedSelection = {
  selection: RangeSelection;
  /** Markdown of the selection, sent to the rewrite route. */
  markdown: string;
  /** Plain text, used to check the selection is unchanged before replacing. */
  plain: string;
  /** Live DOM range, so the panel follows the text when the page scrolls. */
  range: Range | null;
};

export type RewritePanel =
  | { status: "loading"; mode: StudioRewriteMode; captured: CapturedSelection }
  | {
      status: "ready";
      mode: StudioRewriteMode;
      captured: CapturedSelection;
      options: string[];
    };

const MODE_LABEL: Record<StudioRewriteMode, string> = {
  rewrite: "Rewrite",
  tighten: "Tighten",
  subtext: "More subtext",
  custom: "Ask",
};

/** The original beside the one AI rewrite: Keep replaces the selection. */
export function RewriteOptions({
  onClose,
  onKeep,
  onRetry,
  panel,
}: {
  onClose: () => void;
  onKeep: (option: string) => void;
  onRetry: () => void;
  panel: RewritePanel;
}) {
  const [option] = panel.status === "ready" ? panel.options : [];
  return (
    <div className="flex w-[min(30rem,calc(100vw-3rem))] flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          <span aria-hidden="true" className="mr-1 text-accent">
            ✦
          </span>
          {MODE_LABEL[panel.mode]}
          {panel.status === "loading" ? " · writing…" : ""}
        </p>
        {panel.status === "loading" ? (
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2">
        <div className="rounded-sm border border-border/70 px-3 py-2">
          <p className="mb-1 text-caption text-muted-foreground">Original</p>
          <p className="line-clamp-4 whitespace-pre-wrap font-content text-body text-foreground/80">
            {panel.captured.plain}
          </p>
        </div>
        {option !== undefined ? (
          <div className="rounded-sm border border-studio-proposed/60 px-3 py-2">
            <p className="mb-1 text-caption text-studio-proposed">Rewrite</p>
            <p className="whitespace-pre-wrap font-content text-body">
              {option.replace(/[*_]/g, "")}
            </p>
          </div>
        ) : null}
      </div>
      {option !== undefined ? (
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Close
          </Button>
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            Try again
          </Button>
          <Button onClick={() => onKeep(option)} size="sm" type="button">
            Keep
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const askFormSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1, "Say how the passage should change.")
    .max(
      STUDIO_REWRITE_MAX_INSTRUCTION_CHARS,
      "Keep the instruction to 500 characters or fewer.",
    ),
});
type AskFormValues = z.infer<typeof askFormSchema>;

/** "Ask…": a custom instruction. It submits to the rewrite route, so plain useForm. */
export function AskForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (instruction: string) => void;
}) {
  const form = useForm<AskFormValues>({
    defaultValues: { instruction: "" },
    resolver: formResolver(askFormSchema),
  });
  const error = form.formState.errors.instruction?.message;

  return (
    <form
      className="flex w-[min(26rem,calc(100vw-3rem))] flex-col gap-1 p-1"
      onSubmit={form.handleSubmit((values) => onSubmit(values.instruction))}
    >
      <div className="flex items-center gap-1">
        <Input
          aria-describedby={error ? "studio-ask-error" : undefined}
          aria-invalid={Boolean(error)}
          aria-label="How should the passage change?"
          autoFocus
          className="h-8"
          maxLength={STUDIO_REWRITE_MAX_INSTRUCTION_CHARS}
          placeholder="How should it change?"
          {...form.register("instruction")}
        />
        <Button size="sm" type="submit">
          Rewrite
        </Button>
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="px-1 text-caption text-destructive" id="studio-ask-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
