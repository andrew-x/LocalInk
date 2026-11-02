"use client";

import { ArrowUp, Square } from "lucide-react";
import type { FormEventHandler, Ref } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";

import type { StudioChatComposerFormValues } from "@/actions/studio/_schemas";
import { Button } from "@/components/common/button";
import { Textarea } from "@/components/common/textarea";
import { STUDIO_CHAT_MAX_MESSAGE_CHARS } from "@/lib/studio/chat-contract";

import type { ChatTurnStatus } from "./use-chat-turn";

const COUNTER_FROM = STUDIO_CHAT_MAX_MESSAGE_CHARS - 500;

type ChatComposerProps = {
  form: UseFormReturn<StudioChatComposerFormValues>;
  status: ChatTurnStatus;
  /** Why sending is blocked besides a running turn, if it is. */
  blockedReason: string | null;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onStop: () => void;
  textareaRef: Ref<HTMLTextAreaElement>;
};

/**
 * The AI box's message line. It grows with its text; Enter sends,
 * Shift+Enter adds a line. While a turn runs it is disabled and Send
 * becomes Stop.
 */
export function ChatComposer({
  form,
  status,
  blockedReason,
  onSubmit,
  onStop,
  textareaRef,
}: ChatComposerProps) {
  const content = useWatch({ control: form.control, name: "content" });
  const { ref: registerRef, ...field } = form.register("content");
  const fieldError = form.formState.errors.content?.message;
  const serverError = form.formState.errors.root?.serverError?.message;
  const error = fieldError ?? serverError;
  const canStop = status === "preparing" || status === "streaming";
  const busy = status !== "idle";
  // A save-failed reply waits on the author (Retry save / Discard), so Send
  // is disabled but not spinning.
  const working = status === "saving" || status === "stopping";
  const disabled = busy || blockedReason !== null;
  const errorId = "studio-chat-composer-error";
  const length = content?.length ?? 0;

  return (
    <form className="flex flex-col gap-1" noValidate onSubmit={onSubmit}>
      <div className="flex items-end gap-2 rounded-lg border border-input bg-card/80 py-1 pr-1 pl-2.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/35">
        <span
          aria-hidden="true"
          className="shrink-0 select-none pb-[0.3125rem] text-studio-proposed"
        >
          ✦
        </span>
        <Textarea
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(fieldError)}
          aria-label="Message the AI"
          className="max-h-40 min-h-7 flex-1 resize-none overflow-y-auto rounded-none border-0 bg-transparent px-0 py-1 text-label-sm shadow-none focus-visible:border-0 focus-visible:bg-transparent focus-visible:ring-0 aria-invalid:ring-0"
          disabled={disabled}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              // Same guard as the Send button: an empty message does nothing.
              if (!disabled && event.currentTarget.value.trim()) {
                event.currentTarget.form?.requestSubmit();
              }
            }
          }}
          placeholder={blockedReason ?? "Ask the AI to plan, change, or write…"}
          ref={(element) => {
            registerRef(element);
            if (typeof textareaRef === "function") textareaRef(element);
            else if (textareaRef) textareaRef.current = element;
          }}
          rows={1}
          {...field}
        />
        {canStop ? (
          <Button
            aria-label="Stop the reply"
            className="size-7 shrink-0"
            onClick={onStop}
            size="icon"
            tooltip="Stop"
            type="button"
            variant="outline"
          >
            <Square aria-hidden="true" className="size-3 fill-current" />
          </Button>
        ) : (
          <Button
            aria-label="Send message"
            className="size-7 shrink-0"
            disabled={disabled || !content?.trim()}
            loading={working}
            size="icon"
            type="submit"
          >
            {working ? null : <ArrowUp aria-hidden="true" className="size-4" />}
          </Button>
        )}
      </div>
      {error || length > COUNTER_FROM ? (
        <div className="flex items-start justify-between gap-2 px-0.5">
          {error ? (
            <p className="text-caption text-destructive" id={errorId}>
              {error}
            </p>
          ) : (
            <span />
          )}
          {length > COUNTER_FROM ? (
            <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
              {length.toLocaleString("en-US")} /{" "}
              {STUDIO_CHAT_MAX_MESSAGE_CHARS.toLocaleString("en-US")}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
