"use client";

import { useId, useState } from "react";

import { Input } from "@/components/common/input";
import {
  MENU_ITEM_CLASS,
  OutlineMenu,
} from "@/components/studio/outline/scene-menu";
import type { StudioVoicePick } from "@/lib/studio/contracts";
import {
  effectivePickChoice,
  STUDIO_VOICE_LIMITS,
  type StudioVoiceOp,
} from "@/lib/studio/voice";
import { cn } from "@/lib/util";

type ChooseOp = Extract<StudioVoiceOp, { kind: "choose" }>;

type PickRowProps = {
  pick: StudioVoicePick;
  onChoose: (op: ChooseOp) => void;
  onRemove: (pickId: string) => void;
};

/**
 * One voice question as a segmented control. The dot marks what most stories
 * like this one do; the filled segment is what the story uses now. The ⋯ menu
 * holds the question, why it matters, "Something else…" and Remove.
 */
export function PickRow({ pick, onChoose, onRemove }: PickRowProps) {
  const groupName = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const { option, custom } = effectivePickChoice(pick);

  function submitCustom(text: string) {
    setWriting(false);
    const trimmed = text.trim();
    if (!trimmed || trimmed === custom) return;
    onChoose({
      kind: "choose",
      pickId: pick.id,
      optionId: null,
      custom: trimmed,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[5.75rem_1fr_auto] items-center gap-2">
        <span className="text-label-sm font-normal text-muted-foreground">
          {pick.label}
        </span>
        {custom !== null ? (
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-caption">
            <span className="min-w-0 flex-1 break-words">{custom}</span>
            <button
              className="shrink-0 cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() =>
                onChoose({
                  kind: "choose",
                  pickId: pick.id,
                  optionId: null,
                  custom: null,
                })
              }
              type="button"
            >
              Use the options
            </button>
          </div>
        ) : (
          <div
            aria-label={pick.label}
            className="flex overflow-hidden rounded-md border border-border bg-card"
            role="radiogroup"
          >
            {pick.options.map((candidate) => {
              const selected = option?.id === candidate.id;
              return (
                <label
                  className={cn(
                    "relative flex min-w-0 flex-1 cursor-pointer items-center justify-center border-border border-l px-1 py-1 text-center text-caption leading-tight first:border-l-0 focus-within:ring-2 focus-within:ring-ring/40 focus-within:ring-inset",
                    selected
                      ? "bg-primary/20 font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                  key={candidate.id}
                  title={candidate.hint || undefined}
                >
                  <input
                    checked={selected}
                    className="sr-only"
                    name={groupName}
                    onChange={() =>
                      onChoose({
                        kind: "choose",
                        pickId: pick.id,
                        optionId: candidate.id,
                        custom: null,
                      })
                    }
                    type="radio"
                  />
                  {candidate.label}
                  {candidate.id === pick.suggestedOptionId ? (
                    <span
                      aria-label="Suggested"
                      className="absolute top-[3px] right-1 size-1 rounded-full bg-primary"
                      role="img"
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        )}
        <OutlineMenu
          contentClassName="w-64"
          label={`More for ${pick.label}`}
          onOpenChange={setMenuOpen}
          open={menuOpen}
        >
          <div className="flex flex-col gap-1 px-2 pt-1 pb-2">
            <p className="font-medium text-label-sm">{pick.question}</p>
            {pick.why ? (
              <p className="font-normal text-caption text-muted-foreground">
                {pick.why}
              </p>
            ) : null}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            className={MENU_ITEM_CLASS}
            onClick={() => {
              setMenuOpen(false);
              setWriting(true);
            }}
            type="button"
          >
            Something else…
          </button>
          <button
            className={cn(MENU_ITEM_CLASS, "text-destructive")}
            onClick={() => {
              setMenuOpen(false);
              onRemove(pick.id);
            }}
            type="button"
          >
            Remove
          </button>
        </OutlineMenu>
      </div>
      {writing ? (
        <Input
          aria-label={`Your own answer for ${pick.label}`}
          autoFocus
          className="h-8 text-label-sm"
          defaultValue={custom ?? ""}
          maxLength={STUDIO_VOICE_LIMITS.customChars}
          onBlur={(event) => submitCustom(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setWriting(false);
            }
          }}
          placeholder="In your own words"
        />
      ) : null}
    </div>
  );
}
