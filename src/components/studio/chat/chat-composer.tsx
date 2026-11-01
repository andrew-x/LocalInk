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
 * The message box. Enter sends, Shift+Enter adds a line. While a turn runs
 * it is disabled and Send becomes Stop.
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
  const disabled = busy || blockedReason !== null;
  const errorId = "studio-chat-composer-error";

  return (
    <form className="flex flex-col gap-1" noValidate onSubmit={onSubmit}>
      <div className="flex items-end gap-2">
        <Textarea
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(fieldError)}
          aria-label="Message the story assistant"
          className="max-h-48 min-h-16 resize-none overflow-y-auto"
          disabled={disabled}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!disabled) event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            blockedReason ??
            "Brainstorm, ask about the story, or ask for changes"
          }
          ref={(element) => {
            registerRef(element);
            if (typeof textareaRef === "function") textareaRef(element);
            else if (textareaRef) textareaRef.current = element;
          }}
          rows={2}
          {...field}
        />
        {canStop ? (
          <Button
            aria-label="Stop the reply"
            className="size-8 shrink-0"
            onClick={onStop}
            size="icon"
            tooltip="Stop"
            type="button"
            variant="outline"
          >
            <Square aria-hidden="true" className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            aria-label="Send message"
            className="size-8 shrink-0"
            disabled={disabled || !content?.trim()}
            loading={busy}
            size="icon"
            type="submit"
          >
            {busy ? null : <ArrowUp aria-hidden="true" className="size-4" />}
          </Button>
        )}
      </div>
      <div className="flex min-h-4 items-start justify-between gap-2">
        {error ? (
          <p className="text-caption text-destructive" id={errorId}>
            {error}
          </p>
        ) : (
          <span />
        )}
        {(content?.length ?? 0) > COUNTER_FROM ? (
          <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
            {(content?.length ?? 0).toLocaleString("en-US")} /{" "}
            {STUDIO_CHAT_MAX_MESSAGE_CHARS.toLocaleString("en-US")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
