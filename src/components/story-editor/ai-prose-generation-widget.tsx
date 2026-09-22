"use client";

import { ChevronDown, ChevronUp, Square, WandSparkles } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import type {
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { updateStory } from "@/actions/stories/update-story";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Textarea } from "@/components/common/textarea";
import type {
  AiDraftInlineAction,
  AiDraftStatus,
  ChapterAiDraftHandle,
  ChapterAiDraftInsertionContext,
} from "@/components/story-editor/chapter-ai-draft-plugin";
import { AI_DRAFT_INLINE_ACTION_EVENT as DRAFT_INLINE_ACTION_EVENT } from "@/components/story-editor/chapter-ai-draft-plugin";
import {
  isLocalinkIncompleteFinish,
  readLocalinkTextStream,
} from "@/lib/ai-text-stream";
import { formResolver } from "@/lib/schemas/resolve";
import {
  MAX_STORY_PROSE_BEAT_GOAL_LENGTH,
  MAX_STORY_PROSE_INSTRUCTIONS_LENGTH,
  type StoryProseGenerationFormValues,
  type StoryProseGenerationRequest,
  storyProseGenerationFormSchema,
} from "@/lib/story-prose-generation-contract";

// `systemInstructions` rides along with story identity because it reaches the
// model as system-prompt authority, not as request context like `style`.
type StoryIdentity = Pick<
  StoryEditorData,
  "description" | "id" | "name" | "systemInstructions"
>;
type LengthOption = StoryProseGenerationRequest["approximateLength"];
type PacingOption = StoryProseGenerationRequest["pacing"];
type StoryProseContextBase = Omit<
  StoryProseGenerationRequest,
  "approximateLength" | "beatGoal" | "instructions" | "pacing" | "regeneration"
>;

type ActiveDraft = {
  approximateLength: LengthOption;
  beatGoal: string;
  chapterId: string;
  contextBase: StoryProseContextBase;
  draftId: string;
  instructions: string;
  pacing: PacingOption;
};

type AiProseGenerationWidgetProps = {
  characters: StoryContext["characters"];
  chapters: StoryChapterItem[];
  focusedChapterId: string | null;
  getAiDraftHandle: (chapterId: string) => ChapterAiDraftHandle | null;
  hasSelectedText: boolean;
  locations: StoryContext["locations"];
  onContextSaved: (context: StoryContext & { updatedAt: string }) => void;
  onDraftStreamUpdate: (
    draftId: string,
    options?: { resetFollow?: boolean },
  ) => void;
  story: StoryIdentity;
  style: string;
  voiceExemplars: StoryContext["voiceExemplars"];
};

const LENGTH_OPTIONS = [
  { label: "200", value: 200 },
  { label: "400", value: 400 },
  { label: "600", value: 600 },
  { label: "1,000", value: 1_000 },
  { label: "Unlimited", value: "unlimited" },
] as const satisfies ReadonlyArray<{ label: string; value: LengthOption }>;
// How the beat should move, which the length control cannot express. `auto`
// leaves the choice to the model and sends no pacing field at all.
const PACING_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Scene", value: "scene" },
  { label: "Summary", value: "summary" },
  { label: "Interior", value: "interior" },
  { label: "Dialogue", value: "dialogue" },
] as const satisfies ReadonlyArray<{ label: string; value: PacingOption }>;
const PROMPT_SNAPSHOT_ID_HEADER = "X-Prose-Prompt-Snapshot-Id";
// Both mirror the caps enforced by the story action schema.
const MAX_VOICE_EXEMPLARS = 3;
const MAX_VOICE_EXEMPLAR_CHARS = 4_000;

export function AiProseGenerationWidget({
  characters,
  chapters,
  focusedChapterId,
  getAiDraftHandle,
  hasSelectedText,
  locations,
  onContextSaved,
  onDraftStreamUpdate,
  story,
  style,
  voiceExemplars,
}: AiProseGenerationWidgetProps) {
  const form = useForm<
    z.input<typeof storyProseGenerationFormSchema>,
    unknown,
    StoryProseGenerationFormValues
  >({
    defaultValues: {
      approximateLength: 400,
      beatGoal: "",
      instructions: "",
      pacing: "auto",
    },
    resolver: formResolver(storyProseGenerationFormSchema),
    shouldUnregister: false,
  });
  const { clearErrors, setError } = form;
  const instructions = form.watch("instructions");
  const beatGoal = form.watch("beatGoal") ?? "";
  const errorMessage = form.formState.errors.root?.message;
  const [showBeatGoal, setShowBeatGoal] = useState(false);
  const formId = useId();
  const instructionsId = `${formId}-instructions`;
  const beatGoalId = `${formId}-beat-goal`;
  const pacingId = `${formId}-pacing`;
  const lengthId = `${formId}-length`;
  const setErrorMessage = useCallback(
    (message: string | null) => {
      if (message) setError("root", { message });
      else clearErrors("root");
    },
    [clearErrors, setError],
  );
  const [status, setStatus] = useState<AiDraftStatus | "idle">("idle");
  const [activeDraft, setActiveDraft] = useState<ActiveDraft | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const draftTextRef = useRef("");
  const isStreaming = status === "streaming";
  const isGenerationWidgetDisabled = isStreaming || Boolean(activeDraft);

  useEffect(
    () => () => {
      const controller = abortControllerRef.current;
      abortControllerRef.current = null;
      controller?.abort();
    },
    [],
  );

  useEffect(() => {
    function handleInlineDraftAction(event: Event) {
      const detail = (event as CustomEvent<AiDraftInlineAction>).detail;

      if (!activeDraft || detail.draftId !== activeDraft.draftId) {
        return;
      }

      if (detail.action === "accept") {
        handleAccept(detail.text);
        return;
      }

      if (detail.action === "reject") {
        handleReject();
        return;
      }

      if (detail.action === "select") {
        handleSelectDraftVersion(detail.index, detail.text, detail.status);
        return;
      }

      if (detail.action === "pin-voice") {
        void handlePinVoiceExemplar(detail.text);
        return;
      }

      void handleRegenerate(detail.instructions, detail.text);
    }

    window.addEventListener(DRAFT_INLINE_ACTION_EVENT, handleInlineDraftAction);

    return () => {
      window.removeEventListener(
        DRAFT_INLINE_ACTION_EVENT,
        handleInlineDraftAction,
      );
    };
  });

  const streamDraft = useCallback(
    async (
      draft: ActiveDraft,
      regeneration?: StoryProseGenerationRequest["regeneration"] | undefined,
      appendVersion = false,
    ) => {
      const handle = getAiDraftHandle(draft.chapterId);

      if (!handle) {
        const message = "The chapter editor is no longer available.";
        setErrorMessage(message);
        setStatus("error");
        toast.error(message);
        return;
      }

      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const requestBody: StoryProseGenerationRequest = {
        ...draft.contextBase,
        approximateLength: draft.approximateLength,
        beatGoal: draft.beatGoal,
        instructions: draft.instructions,
        pacing: draft.pacing,
        regeneration,
      };
      let streamedText = "";
      let promptSnapshotId: string | undefined;

      setStatus("streaming");
      draftTextRef.current = "";
      setErrorMessage(null);
      handle.setContentEditable(false);
      if (appendVersion) {
        handle.beginDraftVersion(draft.draftId);
      }
      handle.updateDraft(draft.draftId, "", "streaming");
      onDraftStreamUpdate(draft.draftId, { resetFollow: true });

      try {
        const response = await fetch("/api/story-prose", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readGenerationError(response));
        }

        promptSnapshotId =
          response.headers.get(PROMPT_SNAPSHOT_ID_HEADER)?.trim() || undefined;

        await readLocalinkTextStream(response, {
          incompleteMessage:
            "The prose stream ended before generation completed.",
          unavailableMessage: "The prose stream could not be opened.",
          onDelta(text) {
            if (
              abortControllerRef.current !== controller ||
              controller.signal.aborted
            )
              return;
            streamedText += text;
            draftTextRef.current = streamedText;
            handle.updateDraft(
              draft.draftId,
              streamedText,
              "streaming",
              promptSnapshotId,
            );
            onDraftStreamUpdate(draft.draftId);
          },
        });

        if (
          abortControllerRef.current !== controller ||
          controller.signal.aborted
        )
          return;
        handle.updateDraft(
          draft.draftId,
          streamedText,
          "complete",
          promptSnapshotId,
        );
        onDraftStreamUpdate(draft.draftId);
        releaseEditorAfterDraft(handle, draft);
        setStatus("complete");
      } catch (error) {
        if (abortControllerRef.current !== controller) return;
        if (controller.signal.aborted) {
          handle.updateDraft(
            draft.draftId,
            draftTextRef.current,
            "stopped",
            promptSnapshotId,
          );
          onDraftStreamUpdate(draft.draftId);
          releaseEditorAfterDraft(handle, draft);
          setStatus("stopped");
          return;
        }

        const incomplete = isLocalinkIncompleteFinish(error);
        const nextStatus = incomplete ? "incomplete" : "error";
        const message = `${getGenerationFailureMessage(error)}${incomplete && draftTextRef.current ? " The partial draft is available to review, accept, or regenerate." : ""}`;
        handle.updateDraft(
          draft.draftId,
          draftTextRef.current,
          nextStatus,
          promptSnapshotId,
        );
        onDraftStreamUpdate(draft.draftId);
        releaseEditorAfterDraft(handle, draft);
        setErrorMessage(message);
        setStatus(nextStatus);
        toast.error(message);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [getAiDraftHandle, onDraftStreamUpdate, setErrorMessage],
  );

  async function handleGenerate(values: StoryProseGenerationFormValues) {
    if (isStreaming || activeDraft) {
      return;
    }

    const focusedChapter = chapters.find(
      (chapter) => chapter.id === focusedChapterId,
    );

    if (!focusedChapter) {
      const message = "Select a chapter before generating prose.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    const handle = getAiDraftHandle(focusedChapter.id);

    if (!handle) {
      const message = "The chapter editor is not ready yet.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    const snapshot = handle.createDraftSnapshot();

    if (!snapshot) {
      const message = "The insertion point could not be prepared.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    const contextBase = buildContextBase({
      characters,
      chapters,
      focusedChapter,
      insertionContext: snapshot,
      locations,
      story,
      style,
      voiceExemplars,
    });
    const draft: ActiveDraft = {
      approximateLength: values.approximateLength,
      beatGoal: values.beatGoal,
      chapterId: focusedChapter.id,
      contextBase,
      draftId: snapshot.draftId,
      instructions: values.instructions,
      pacing: values.pacing,
    };

    setActiveDraft(draft);
    await streamDraft(draft);
  }

  function handleGenerationShortcut(event: KeyboardEvent<HTMLFormElement>) {
    if (!isGenerationShortcut(event) || isGenerationWidgetDisabled) {
      return;
    }

    event.preventDefault();
    event.currentTarget.requestSubmit();
  }

  function handleStop() {
    if (!activeDraft) {
      return;
    }

    const controller = abortControllerRef.current;
    abortControllerRef.current = null;
    controller?.abort();
    const handle = getAiDraftHandle(activeDraft.chapterId);

    if (handle) releaseEditorAfterDraft(handle, activeDraft);
    handle?.updateDraft(activeDraft.draftId, draftTextRef.current, "stopped");
    setStatus("stopped");
  }

  function handleAccept(text = draftTextRef.current) {
    if (!activeDraft) {
      return;
    }

    const handle = getAiDraftHandle(activeDraft.chapterId);

    if (!handle) {
      const message = "The chapter editor is no longer available.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }

    if (!handle.acceptDraft(activeDraft.draftId, text)) {
      const message =
        "The draft could not be accepted. The original chapter has been preserved.";
      setErrorMessage(message);
      toast.error(message);
      return;
    }
    handle.setContentEditable(true);
    form.resetField("instructions");
    form.resetField("beatGoal");
    resetDraftState();
  }

  function handleReject() {
    if (!activeDraft) {
      return;
    }

    const controller = abortControllerRef.current;
    abortControllerRef.current = null;
    controller?.abort();
    const handle = getAiDraftHandle(activeDraft.chapterId);
    handle?.removeDraft(activeDraft.draftId);
    handle?.setContentEditable(true);

    resetDraftState();
  }

  function handleSelectDraftVersion(
    index: number,
    text: string,
    nextStatus: AiDraftStatus,
  ) {
    if (!activeDraft || isStreaming) {
      return;
    }

    const handle = getAiDraftHandle(activeDraft.chapterId);

    handle?.selectDraftVersion(activeDraft.draftId, index);
    draftTextRef.current = text;
    setStatus(nextStatus);

    if (nextStatus !== "error") {
      setErrorMessage(null);
    }
  }

  /**
   * Rebuilds the manuscript context around the draft node before regenerating.
   *
   * The context captured at first generation goes stale as soon as any chapter
   * is edited, and the draft node — not the caret, which has moved on by now —
   * is what still marks the insertion point.
   */
  function refreshDraftContext(draft: ActiveDraft): ActiveDraft {
    const focusedChapter = chapters.find(
      (chapter) => chapter.id === draft.chapterId,
    );
    const insertionContext = getAiDraftHandle(
      draft.chapterId,
    )?.readInsertionContext(draft.draftId);

    if (!focusedChapter || !insertionContext) {
      return draft;
    }

    return {
      ...draft,
      contextBase: buildContextBase({
        characters,
        chapters,
        focusedChapter,
        insertionContext: {
          ...insertionContext,
          // Carried forward rather than re-read: the draft node already
          // stands where the rewritten span was, so it is no longer in the
          // chapter to find, but the request still targets it.
          selectedText: draft.contextBase.insertion.selectedText,
        },
        locations,
        story,
        style,
        voiceExemplars,
      }),
    };
  }

  async function handleRegenerate(regenerationInstructions = "", text = "") {
    if (!activeDraft || isStreaming) {
      return;
    }

    const refreshedDraft = refreshDraftContext(activeDraft);

    setActiveDraft(refreshedDraft);

    await streamDraft(
      refreshedDraft,
      buildRegenerationRequest(regenerationInstructions, text),
      true,
    );
  }

  /**
   * Keeps a draft the writer liked as a voice sample for this story.
   *
   * Almost none of the manuscript is hand-written, so recognising good output
   * is the realistic way to establish a voice target. The label is a
   * placeholder; samples are renamed and edited in the context pane.
   */
  async function handlePinVoiceExemplar(text: string) {
    const passage = toVoiceExemplarPassage(text);

    if (!passage) {
      return;
    }

    if (voiceExemplars.length >= MAX_VOICE_EXEMPLARS) {
      toast.error(
        `This story already has ${MAX_VOICE_EXEMPLARS} voice samples. Remove one in the context pane first.`,
      );
      return;
    }

    const result = await updateStory({
      description: story.description,
      id: story.id,
      name: story.name,
      voiceExemplars: [
        ...voiceExemplars,
        { label: buildVoiceExemplarLabel(voiceExemplars), text: passage },
      ],
    });

    if (!result?.data) {
      toast.error("The voice sample could not be saved.");
      return;
    }

    onContextSaved(result.data);
    toast.success(
      passage.length < text.trim().length
        ? "Pinned the opening of this draft as a voice sample."
        : "Pinned this draft as a voice sample.",
    );
  }

  function resetDraftState() {
    const controller = abortControllerRef.current;
    abortControllerRef.current = null;
    controller?.abort();
    setActiveDraft(null);
    draftTextRef.current = "";
    setStatus("idle");
    setErrorMessage(null);
  }

  return (
    <div className="z-30 flex max-h-[60%] min-h-0 shrink-0 flex-col px-page pb-4 pt-2">
      <form
        className="mx-auto flex min-h-0 w-full max-w-readable flex-col overflow-hidden rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-lg"
        noValidate
        onKeyDown={handleGenerationShortcut}
        onSubmit={form.handleSubmit(handleGenerate, (errors) => {
          if (errors.beatGoal) setShowBeatGoal(true);
        })}
      >
        <div className="min-h-0 overflow-y-auto p-3">
          <label
            className="mb-2 block text-label font-medium"
            htmlFor={instructionsId}
          >
            {hasSelectedText
              ? "How should the selected prose change?"
              : "What happens next?"}
          </label>
          <Textarea
            {...form.register("instructions")}
            aria-describedby={`${instructionsId}-hint ${instructionsId}-count${form.formState.errors.instructions ? ` ${instructionsId}-error` : ""}`}
            aria-invalid={Boolean(form.formState.errors.instructions)}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="max-h-64 min-h-0 resize-none overflow-y-auto font-content"
            disabled={isGenerationWidgetDisabled}
            id={instructionsId}
            maxLength={MAX_STORY_PROSE_INSTRUCTIONS_LENGTH}
            rows={1}
          />
          <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-caption text-muted-foreground">
            <p id={`${instructionsId}-hint`}>
              Enter for a new line · ⌘/Ctrl+Enter to generate
            </p>
            <p id={`${instructionsId}-count`}>
              {instructions.length.toLocaleString("en-US")} / 10,000
            </p>
          </div>
          {form.formState.errors.instructions ? (
            <p
              className="mt-1 text-caption text-destructive"
              id={`${instructionsId}-error`}
              role="alert"
            >
              {form.formState.errors.instructions.message}
            </p>
          ) : null}
          <div className={showBeatGoal ? "mt-2" : "mt-1"}>
            <Button
              aria-controls={`${beatGoalId}-details`}
              aria-expanded={showBeatGoal}
              className={
                showBeatGoal
                  ? "h-auto min-h-7 max-w-full justify-start whitespace-normal px-2 py-1 text-left"
                  : "h-auto min-h-0 max-w-full justify-start gap-1 whitespace-normal px-0 py-0.5 text-left text-caption"
              }
              leftSection={
                showBeatGoal ? (
                  <ChevronUp aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-3" />
                )
              }
              onClick={() => setShowBeatGoal((shown) => !shown)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="min-w-0">
                {showBeatGoal || beatGoal.trim()
                  ? "Beat change"
                  : "Add beat change"}
                {showBeatGoal || beatGoal.trim() ? (
                  <span className="font-normal text-muted-foreground">
                    {showBeatGoal ? " · Optional" : " · Added"}
                  </span>
                ) : null}
              </span>
            </Button>
            <div
              hidden={!showBeatGoal}
              id={`${beatGoalId}-details`}
              className="mt-2 space-y-1.5"
            >
              <label className="text-label" htmlFor={beatGoalId}>
                What changes in this beat?{" "}
                <span className="text-muted-foreground">(optional)</span>
              </label>
              <p
                className="text-caption text-muted-foreground"
                id={`${beatGoalId}-hint`}
              >
                What should be different by the end?
              </p>
              <Input
                {...form.register("beatGoal")}
                aria-describedby={`${beatGoalId}-hint${form.formState.errors.beatGoal ? ` ${beatGoalId}-error` : ""}`}
                aria-invalid={Boolean(form.formState.errors.beatGoal)}
                className="min-w-0"
                disabled={isGenerationWidgetDisabled}
                id={beatGoalId}
                maxLength={MAX_STORY_PROSE_BEAT_GOAL_LENGTH}
                placeholder="A decision made, a secret revealed, a relationship changed…"
              />
              {form.formState.errors.beatGoal ? (
                <p
                  className="text-caption text-destructive"
                  id={`${beatGoalId}-error`}
                  role="alert"
                >
                  {form.formState.errors.beatGoal.message}
                </p>
              ) : null}
            </div>
          </div>
          {errorMessage ? (
            <p
              className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
              role="alert"
            >
              {errorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 bg-muted/30 px-3 py-2">
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
            <label
              className="text-caption text-muted-foreground"
              htmlFor={pacingId}
            >
              Pacing
            </label>
            <select
              {...form.register("pacing")}
              aria-invalid={Boolean(form.formState.errors.pacing)}
              className="h-8 min-w-0 max-w-full rounded-md border border-input bg-card/80 px-2 py-1 text-label shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
              disabled={isGenerationWidgetDisabled}
              id={pacingId}
            >
              {PACING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
            <label
              className="text-caption text-muted-foreground"
              htmlFor={lengthId}
            >
              Word count
            </label>
            <select
              {...form.register("approximateLength", {
                setValueAs: parseLengthOption,
              })}
              aria-invalid={Boolean(form.formState.errors.approximateLength)}
              className="h-8 min-w-0 max-w-full rounded-md border border-input bg-card/80 px-2 py-1 text-label shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
              disabled={isGenerationWidgetDisabled}
              id={lengthId}
            >
              {LENGTH_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.value === "unlimited"
                    ? option.label
                    : `≈${option.label}`}
                </option>
              ))}
            </select>
          </div>
          {isStreaming ? (
            <Button
              className="ml-auto h-8"
              leftSection={<Square aria-hidden="true" />}
              onClick={handleStop}
              size="sm"
              type="button"
              variant="outline"
            >
              Stop
            </Button>
          ) : !activeDraft ? (
            <Button
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className="ml-auto h-8"
              disabled={!chapters.length}
              leftSection={<WandSparkles aria-hidden="true" />}
              size="sm"
              type="submit"
            >
              Generate
            </Button>
          ) : (
            <p className="ml-auto text-caption text-muted-foreground">
              Review the draft in your manuscript.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

function buildContextBase({
  characters,
  chapters,
  focusedChapter,
  insertionContext,
  locations,
  story,
  style,
  voiceExemplars,
}: {
  characters: StoryContext["characters"];
  chapters: StoryChapterItem[];
  focusedChapter: StoryChapterItem;
  insertionContext: ChapterAiDraftInsertionContext;
  locations: StoryContext["locations"];
  story: StoryIdentity;
  style: string;
  voiceExemplars: StoryContext["voiceExemplars"];
}): StoryProseContextBase {
  return {
    story,
    style,
    characters,
    locations,
    voiceExemplars,
    focusedChapter: toChapterContext(focusedChapter, insertionContext.content),
    chapters: chapters.map((chapter) =>
      toChapterContext(
        chapter,
        chapter.id === focusedChapter.id
          ? insertionContext.content
          : chapter.content,
      ),
    ),
    insertion: {
      afterText: insertionContext.afterText,
      atChapterEnd: insertionContext.atChapterEnd,
      isRewrite: insertionContext.isRewrite,
      beforeText: insertionContext.beforeText,
      selectedText: insertionContext.selectedText,
    },
  };
}

function toChapterContext(
  chapter: StoryChapterItem,
  content = chapter.content,
) {
  return {
    id: chapter.id,
    name: chapter.name,
    position: chapter.position,
    content,
    synopsis: chapter.synopsis,
  };
}

/**
 * Trims a draft down to something usable as a voice sample.
 *
 * Samples are capped well below a long draft's length, and a sample cut
 * mid-sentence teaches the model a shape it should not copy, so the passage
 * is backed up to the last sentence that fits.
 */
function toVoiceExemplarPassage(text: string): string {
  const passage = text.trim();

  if (passage.length <= MAX_VOICE_EXEMPLAR_CHARS) {
    return passage;
  }

  const head = passage.slice(0, MAX_VOICE_EXEMPLAR_CHARS);
  const lastSentenceEnd = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? "),
    head.lastIndexOf("\n"),
  );

  return lastSentenceEnd > 0
    ? head.slice(0, lastSentenceEnd + 1).trim()
    : head.trim();
}

function buildVoiceExemplarLabel(
  voiceExemplars: StoryContext["voiceExemplars"],
): string {
  return `Pinned sample ${voiceExemplars.length + 1}`;
}

/**
 * Re-enables editing once a draft stops streaming — unless it is a rewrite.
 *
 * A rewrite has displaced the selected prose until the writer accepts or
 * rejects. Editing in that window would autosave the chapter without it, so
 * the deletion could outlive a draft that was never accepted. Accept and
 * reject both resolve the draft and unlock the chapter themselves.
 */
function releaseEditorAfterDraft(
  handle: ChapterAiDraftHandle,
  draft: ActiveDraft,
) {
  if (
    draft.contextBase.insertion.isRewrite ||
    draft.contextBase.insertion.selectedText
  ) {
    return;
  }

  handle.setContentEditable(true);
}

function parseLengthOption(value: string): LengthOption {
  const option = LENGTH_OPTIONS.find((item) => String(item.value) === value);

  return option?.value ?? 400;
}

function buildRegenerationRequest(
  regenerationInstructions: string,
  priorDraft: string,
): StoryProseGenerationRequest["regeneration"] {
  const regeneration = regenerationInstructions.trim();

  if (!regeneration) {
    return {
      mode: "fresh-alternative",
      priorAttempt: priorDraft,
    };
  }

  return {
    editInstructions: regeneration,
    mode: "revise-prior-draft",
    priorDraft,
  };
}

async function readGenerationError(response: Response) {
  try {
    const data = (await response.json()) as { message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    return "The prose could not be generated.";
  }

  return "The prose could not be generated.";
}

function getGenerationFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "The prose could not be generated.";
}

function isGenerationShortcut(event: KeyboardEvent) {
  return (
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey) &&
    !event.nativeEvent.isComposing
  );
}
