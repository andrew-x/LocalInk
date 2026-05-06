"use client";

import { Square, WandSparkles } from "lucide-react";
import {
  type FormEvent,
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
import { Button } from "@/components/common/button";
import type {
  AiDraftInlineAction,
  AiDraftStatus,
  ChapterAiDraftHandle,
  ChapterAiDraftSnapshot,
} from "@/components/story-editor/chapter-ai-draft-plugin";
import { AI_DRAFT_INLINE_ACTION_EVENT as DRAFT_INLINE_ACTION_EVENT } from "@/components/story-editor/chapter-ai-draft-plugin";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

type StoryIdentity = Pick<StoryEditorData, "description" | "id" | "name">;
type LengthOption = StoryProseGenerationRequest["approximateLength"];
type StoryProseContextBase = Omit<
  StoryProseGenerationRequest,
  "approximateLength" | "instructions" | "regeneration"
>;

type ActiveDraft = {
  approximateLength: LengthOption;
  chapterId: string;
  contextBase: StoryProseContextBase;
  draftId: string;
  instructions: string;
};

type AiProseGenerationWidgetProps = {
  characters: StoryContext["characters"];
  chapters: StoryChapterItem[];
  focusedChapterId: string | null;
  getAiDraftHandle: (chapterId: string) => ChapterAiDraftHandle | null;
  onDraftStreamUpdate: (
    draftId: string,
    options?: { resetFollow?: boolean },
  ) => void;
  story: StoryIdentity;
  style: string;
};

const LENGTH_OPTIONS: LengthOption[] = [200, 400, 600];
const PROMPT_SNAPSHOT_ID_HEADER = "X-Prose-Prompt-Snapshot-Id";

export function AiProseGenerationWidget({
  characters,
  chapters,
  focusedChapterId,
  getAiDraftHandle,
  onDraftStreamUpdate,
  story,
  style,
}: AiProseGenerationWidgetProps) {
  const [instructions, setInstructions] = useState("");
  const [approximateLength, setApproximateLength] = useState<LengthOption>(400);
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
        instructions: draft.instructions,
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

        if (!response.body) {
          throw new Error("The prose stream could not be opened.");
        }

        promptSnapshotId =
          response.headers.get(PROMPT_SNAPSHOT_ID_HEADER)?.trim() || undefined;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          streamedText += decoder.decode(value, { stream: true });
          draftTextRef.current = streamedText;
          handle.updateDraft(
            draft.draftId,
            streamedText,
            "streaming",
            promptSnapshotId,
          );
          onDraftStreamUpdate(draft.draftId);
        }

        const finalChunk = decoder.decode();

        if (finalChunk) {
          streamedText += finalChunk;
          draftTextRef.current = streamedText;
        }

        handle.updateDraft(
          draft.draftId,
          streamedText,
          "complete",
          promptSnapshotId,
        );
        onDraftStreamUpdate(draft.draftId);
        handle.setContentEditable(true);
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
          handle.setContentEditable(true);
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
        handle.setContentEditable(true);
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
      snapshot,
      story,
      style,
    });
    const requestInstructions = instructions;
    const draft = {
      approximateLength,
      chapterId: focusedChapter.id,
      contextBase,
      draftId: snapshot.draftId,
      instructions: requestInstructions,
    };

    setActiveDraft(draft);
    setInstructions("");
    await streamDraft(draft);
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
    resetDraftState();
  }

  function handleReject() {
    if (!activeDraft) {
      return;
    }

    abortControllerRef.current?.abort();
    const handle = getAiDraftHandle(activeDraft.chapterId);

    handle?.setContentEditable(true);
    handle?.removeDraft(activeDraft.draftId);
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

  async function handleRegenerate(regenerationInstructions = "", text = "") {
    if (!activeDraft || isStreaming) {
      return;
    }

    await streamDraft(
      activeDraft,
      buildRegenerationRequest(regenerationInstructions, text),
      true,
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
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={handleGenerate}
        >
          <input
            aria-label="AI prose instructions"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card/80 px-3 py-1 text-body shadow-xs outline-none transition-[background-color,border-color,box-shadow] selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
            disabled={isGenerationWidgetDisabled}
            maxLength={2000}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="What happens next?"
            value={instructions}
          />
          <select
            aria-label="AI prose length"
            className="h-8 rounded-md border border-input bg-card/80 px-2 py-1 text-label shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/35"
            disabled={isGenerationWidgetDisabled}
            onChange={(event) =>
              setApproximateLength(Number(event.target.value) as LengthOption)
            }
            value={approximateLength}
          >
            {LENGTH_OPTIONS.map((length) => (
              <option key={length} value={length}>
                {length}
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
              className="h-8"
              disabled={!chapters.length}
              leftSection={<WandSparkles aria-hidden="true" />}
              size="sm"
              type="submit"
            >
              Generate
            </Button>
          ) : null}
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
  snapshot,
  story,
  style,
}: {
  characters: StoryContext["characters"];
  chapters: StoryChapterItem[];
  focusedChapter: StoryChapterItem;
  snapshot: ChapterAiDraftSnapshot;
  story: StoryIdentity;
  style: string;
}): StoryProseContextBase {
  return {
    story,
    style,
    characters,
    focusedChapter: toChapterContext(focusedChapter, snapshot.content),
    chapters: chapters.map((chapter) =>
      toChapterContext(
        chapter,
        chapter.id === focusedChapter.id ? snapshot.content : chapter.content,
      ),
    ),
    insertion: {
      afterText: snapshot.afterText,
      atChapterEnd: snapshot.atChapterEnd,
      beforeText: snapshot.beforeText,
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
    summary: chapter.summary,
    content,
  };
}

function buildRegenerationRequest(
  regenerationInstructions: string,
  priorDraft: string,
): StoryProseGenerationRequest["regeneration"] {
  const regeneration = regenerationInstructions.trim();

  if (!regeneration) {
    return {
      mode: "fresh-alternative",
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
