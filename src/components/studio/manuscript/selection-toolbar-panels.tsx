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

/** The original beside the three AI options; picking one replaces the selection. */
export function RewriteOptions({
  onClose,
  onPick,
  panel,
}: {
  onClose: () => void;
  onPick: (option: string) => void;
  panel: RewritePanel;
}) {
  return (
    <div className="flex w-[min(30rem,calc(100vw-3rem))] flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">
          <span aria-hidden="true" className="mr-1 text-accent">
            ✦
          </span>
          {MODE_LABEL[panel.mode]}
          {panel.status === "loading" ? " · writing options…" : ""}
        </p>
        <Button onClick={onClose} size="sm" type="button" variant="ghost">
          {panel.status === "loading" ? "Cancel" : "Close"}
        </Button>
      </div>
      <div className="grid gap-2">
        <div className="rounded-sm border border-border/70 px-3 py-2">
          <p className="mb-1 text-caption text-muted-foreground">Original</p>
          <p className="line-clamp-4 whitespace-pre-wrap font-content text-body text-foreground/80">
            {panel.captured.plain}
          </p>
        </div>
        {panel.status === "ready"
          ? panel.options.map((option, index) => (
              <button
                className="rounded-sm border border-border/70 px-3 py-2 text-left transition-colors hover:border-ring/60 hover:bg-muted focus-visible:border-ring focus-visible:outline-none"
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of three options that never reorders, and two options may share text.
                key={index}
                onClick={() => onPick(option)}
                type="button"
              >
                <span className="mb-1 block text-caption text-muted-foreground">
                  Option {index + 1}
                </span>
                <span className="block whitespace-pre-wrap font-content text-body">
                  {option.replace(/[*_]/g, "")}
                </span>
              </button>
            ))
          : null}
      </div>
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
