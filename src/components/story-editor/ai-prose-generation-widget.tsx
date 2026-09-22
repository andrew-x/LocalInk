"use client";

import { Square, WandSparkles } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

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
import { readLocalinkTextStream } from "@/lib/ai-text-stream";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

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
  { label: "Auto pacing", value: "auto" },
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
  const [instructions, setInstructions] = useState("");
  const [beatGoal, setBeatGoal] = useState("");
  const [approximateLength, setApproximateLength] = useState<LengthOption>(400);
  const [pacing, setPacing] = useState<PacingOption>("auto");
  const [status, setStatus] = useState<AiDraftStatus | "idle">("idle");
  const [activeDraft, setActiveDraft] = useState<ActiveDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const draftTextRef = useRef("");
  const isStreaming = status === "streaming";
  const isGenerationWidgetDisabled = isStreaming || Boolean(activeDraft);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
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

        const message = getGenerationFailureMessage(error);
        handle.updateDraft(
          draft.draftId,
          draftTextRef.current,
          "error",
          promptSnapshotId,
        );
        onDraftStreamUpdate(draft.draftId);
        releaseEditorAfterDraft(handle, draft);
        setErrorMessage(message);
        setStatus("error");
        toast.error(message);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [getAiDraftHandle, onDraftStreamUpdate],
  );

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      approximateLength,
      beatGoal,
      chapterId: focusedChapter.id,
      contextBase,
      draftId: snapshot.draftId,
      instructions,
      pacing,
    };

    setActiveDraft(draft);
    await streamDraft(draft);
  }

  function handleInstructionsKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (!isPlainEnter(event) || isGenerationWidgetDisabled) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
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

    abortControllerRef.current?.abort();
    const handle = getAiDraftHandle(activeDraft.chapterId);

    handle?.setContentEditable(true);
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

    handle.setContentEditable(true);
    handle.acceptDraft(activeDraft.draftId, text);
    setInstructions("");
    resetDraftState();
  }

  function handleReject() {
    if (!activeDraft) {
      return;
    }

    abortControllerRef.current?.abort();
    const handle = getAiDraftHandle(activeDraft.chapterId);
    const { selectedText } = activeDraft.contextBase.insertion;

    handle?.setContentEditable(true);

    // Starting a rewrite displaces the selected prose, so rejecting has to
    // put it back rather than just drop the draft node.
    if (selectedText) {
      handle?.restoreRewriteSelection(activeDraft.draftId, selectedText);
    } else {
      handle?.removeDraft(activeDraft.draftId);
    }

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
    setActiveDraft(null);
    draftTextRef.current = "";
    setStatus("idle");
    setErrorMessage(null);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-page pb-4">
      <div className="pointer-events-auto mx-auto w-full max-w-readable rounded-md border border-border/80 bg-popover/95 p-2 text-popover-foreground shadow-2xl backdrop-blur">
        <form
          className="flex flex-col gap-2"
          onKeyDown={handleGenerationShortcut}
          onSubmit={handleGenerate}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              aria-label="AI prose instructions"
              aria-keyshortcuts="Enter Shift+Enter"
              className="max-h-48 min-h-8 min-w-0 flex-1 resize-none px-3 py-[0.1875rem]"
              disabled={isGenerationWidgetDisabled}
              maxLength={2000}
              onChange={(event) => setInstructions(event.target.value)}
              onKeyDown={handleInstructionsKeyDown}
              placeholder={
                hasSelectedText
                  ? "How should the selected prose change?"
                  : "What happens next?"
              }
              rows={1}
              value={instructions}
            />
            <select
              aria-label="AI prose length"
              className="h-8 rounded-md border border-input bg-card/80 px-2 py-1 text-label shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
              disabled={isGenerationWidgetDisabled}
              onChange={(event) =>
                setApproximateLength(parseLengthOption(event.target.value))
              }
              value={String(approximateLength)}
            >
              {LENGTH_OPTIONS.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="AI prose pacing"
              className="h-8 rounded-md border border-input bg-card/80 px-2 py-1 text-label shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
              disabled={isGenerationWidgetDisabled}
              onChange={(event) =>
                setPacing(parsePacingOption(event.target.value))
              }
              value={pacing}
            >
              {PACING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {isStreaming ? (
              <Button
                className="h-8"
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
                className="h-8"
                disabled={!chapters.length}
                leftSection={<WandSparkles aria-hidden="true" />}
                size="sm"
                type="submit"
              >
                Generate
              </Button>
            ) : null}
          </div>

          {/*
            Optional and secondary to the brief. The brief says what happens;
            this says what is different afterwards, which is the thing pacing
            decisions actually hang on.
          */}
          <Input
            aria-label="What changes in this beat"
            className="h-7 min-w-0 bg-card/60 px-3 text-caption"
            disabled={isGenerationWidgetDisabled}
            maxLength={300}
            onChange={(event) => setBeatGoal(event.target.value)}
            placeholder="What changes in this beat? (optional)"
            value={beatGoal}
          />
        </form>

        {errorMessage ? (
          <p
            className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
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
  if (draft.contextBase.insertion.selectedText) {
    return;
  }

  handle.setContentEditable(true);
}

function parseLengthOption(value: string): LengthOption {
  const option = LENGTH_OPTIONS.find((item) => String(item.value) === value);

  return option?.value ?? 400;
}

function parsePacingOption(value: string): PacingOption {
  const option = PACING_OPTIONS.find((item) => item.value === value);

  return option?.value ?? "auto";
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

function isPlainEnter(event: KeyboardEvent) {
  return (
    event.key === "Enter" &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing
  );
}
