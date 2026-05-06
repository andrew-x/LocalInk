"use client";

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  type InitialConfigType,
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState } from "lexical";
import { Circle, CircleAlert, Trash2 } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChapterIndexTriggerReason,
  StoryChapterIndexSnapshot,
  StoryChapterItem,
} from "@/actions/stories/_types";
import { deleteChapter } from "@/actions/stories/delete-chapter";
import { indexChapter } from "@/actions/stories/index-chapter";
import { updateChapterContent } from "@/actions/stories/update-chapter-content";
import { updateChapterTitle } from "@/actions/stories/update-chapter-title";
import { Button } from "@/components/common/button";
import {
  AI_DRAFT_UPDATE_TAG,
  AiDraftNode,
  type ChapterAiDraftHandle,
  ChapterAiDraftPlugin,
} from "@/components/story-editor/chapter-ai-draft-plugin";
import { CHAPTER_MARKDOWN_TRANSFORMERS } from "@/components/story-editor/chapter-markdown";
import { createLogger } from "@/lib/logger";
import { cn } from "@/lib/util";

const AUTOSAVE_DELAY_MS = 800;
const INDEX_DELAY_MS = 2 * 60 * 1000;
const chapterEditorLogger = createLogger("chapter-editor");

const EDITOR_THEME: InitialConfigType["theme"] = {
  paragraph: "mb-5 last:mb-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
  },
};

type SaveState = "saved" | "pending" | "saving" | "error";

const SAVE_STATE_LABELS = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Unsaved changes",
  error: "Could not save",
} satisfies Record<SaveState, string>;

type ChapterContentEditorProps = {
  chapter: StoryChapterItem;
  isActive: boolean;
  onDeleted: (chapterId: string, updatedAt: string) => void;
  onFocus: (chapterId: string) => void;
  onIndexed: (chapter: StoryChapterIndexSnapshot) => void;
  onRegisterAiDraftHandle: (
    chapterId: string,
    handle: ChapterAiDraftHandle | null,
  ) => void;
  onSaved: (chapter: StoryChapterItem) => void;
  storyId: string;
};

export function ChapterContentEditor({
  chapter,
  isActive,
  onDeleted,
  onFocus,
  onIndexed,
  onRegisterAiDraftHandle,
  onSaved,
  storyId,
}: ChapterContentEditorProps) {
  const [contentSaveState, setContentSaveState] = useState<SaveState>("saved");
  const [titleSaveState, setTitleSaveState] = useState<SaveState>("saved");
  const saveState = getCombinedSaveState(titleSaveState, contentSaveState);
  const titleId = `chapter-title-${chapter.id}`;
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: `LocalInkChapter:${chapter.id}`,
      theme: EDITOR_THEME,
      nodes: [AiDraftNode],
      editorState: () => {
        $convertFromMarkdownString(
          chapter.content,
          CHAPTER_MARKDOWN_TRANSFORMERS,
          undefined,
          true,
        );
      },
      onError(error) {
        chapterEditorLogger.error("error", { error });
      },
    }),
    [chapter.content, chapter.id],
  );

  return (
    <li
      aria-labelledby={titleId}
      className={cn(
        "scroll-mt-6 border-border/60 border-t pt-8 first:border-t-0 first:pt-0",
        isActive && "text-foreground",
      )}
      id={`chapter-${chapter.id}`}
      onFocus={() => onFocus(chapter.id)}
    >
      <div className="group/title flex min-h-11 items-center justify-between gap-2 px-1 pb-3">
        <ChapterTitleInput
          chapter={chapter}
          id={titleId}
          onSaveStateChange={setTitleSaveState}
          onSaved={onSaved}
          storyId={storyId}
        />
        <div className="flex shrink-0 items-center gap-1">
          <SaveIndicator state={saveState} />
          <DeleteChapterControl
            chapter={chapter}
            onDeleted={onDeleted}
            storyId={storyId}
          />
        </div>
      </div>

      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <RichTextContentEditable chapterName={chapter.name} />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <MarkdownShortcutPlugin
            transformers={CHAPTER_MARKDOWN_TRANSFORMERS}
          />
          <ChapterAiDraftPlugin
            chapterId={chapter.id}
            onRegister={onRegisterAiDraftHandle}
          />
          <ChapterAutosavePlugin
            chapterId={chapter.id}
            initialContent={chapter.content}
            isActive={isActive}
            onIndexed={onIndexed}
            onSaved={onSaved}
            onSaveStateChange={setContentSaveState}
            storyId={storyId}
          />
        </div>
      </LexicalComposer>
    </li>
  );
}

function getCombinedSaveState(...states: SaveState[]): SaveState {
  if (states.includes("error")) {
    return "error";
  }

  if (states.includes("saving")) {
    return "saving";
  }

  if (states.includes("pending")) {
    return "pending";
  }

  return "saved";
}

type ChapterTitleInputProps = {
  chapter: StoryChapterItem;
  id: string;
  onSaveStateChange: (state: SaveState) => void;
  onSaved: (chapter: StoryChapterItem) => void;
  storyId: string;
};

function ChapterTitleInput({
  chapter,
  id,
  onSaveStateChange,
  onSaved,
  storyId,
}: ChapterTitleInputProps) {
  const { executeAsync } = useAction(updateChapterTitle);
  const [title, setTitle] = useState(chapter.name);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTitleRef = useRef(chapter.name);
  const latestTitleRef = useRef(chapter.name);
  const changeVersionRef = useRef(0);
  const isMountedRef = useRef(true);

  const clearSaveTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearSaveTimer();
    };
  }, [clearSaveTimer]);

  const saveTitle = useCallback(
    async (name: string, version: number) => {
      onSaveStateChange("saving");

      const result = await executeAsync({
        storyId,
        chapterId: chapter.id,
        name,
      });

      if (!isMountedRef.current) {
        return;
      }

      if (!result.data) {
        if (version === changeVersionRef.current) {
          onSaveStateChange("error");
        }
        return;
      }

      if (version !== changeVersionRef.current) {
        return;
      }

      lastSavedTitleRef.current = result.data.name;
      latestTitleRef.current = result.data.name;
      setTitle(result.data.name);
      onSaved(result.data);
      onSaveStateChange("saved");
    },
    [chapter.id, executeAsync, onSaveStateChange, onSaved, storyId],
  );

  const queueSave = useCallback(
    (name: string, version: number) => {
      clearSaveTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void saveTitle(name, version);
      }, AUTOSAVE_DELAY_MS);
    },
    [clearSaveTimer, saveTitle],
  );

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const nextTitle = event.target.value;
    const normalizedTitle = nextTitle.trim();

    setTitle(nextTitle);
    latestTitleRef.current = nextTitle;
    changeVersionRef.current += 1;

    if (!normalizedTitle) {
      clearSaveTimer();
      onSaveStateChange("error");
      return;
    }

    if (normalizedTitle === lastSavedTitleRef.current) {
      clearSaveTimer();
      onSaveStateChange("saved");
      return;
    }

    onSaveStateChange("pending");
    queueSave(normalizedTitle, changeVersionRef.current);
  }

  function handleBlur() {
    if (latestTitleRef.current.trim()) {
      return;
    }

    clearSaveTimer();
    latestTitleRef.current = lastSavedTitleRef.current;
    setTitle(lastSavedTitleRef.current);
    onSaveStateChange("saved");
  }

  return (
    <input
      aria-label="Chapter title"
      autoComplete="off"
      className="min-w-0 flex-1 rounded-sm border-border/0 border-b bg-transparent px-0 py-1 font-content text-[1.375rem] leading-8 text-foreground/95 outline-none transition-[border-color,color] hover:border-border/70 focus:border-ring"
      id={id}
      maxLength={120}
      onBlur={handleBlur}
      onChange={handleChange}
      spellCheck={false}
      value={title}
    />
  );
}

type DeleteChapterControlProps = {
  chapter: StoryChapterItem;
  onDeleted: (chapterId: string, updatedAt: string) => void;
  storyId: string;
};

function DeleteChapterControl({
  chapter,
  onDeleted,
  storyId,
}: DeleteChapterControlProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteChapterAction = useAction(deleteChapter);
  const hasContent = chapter.content.trim().length > 0;
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isConfirmOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !popoverRef.current?.contains(event.target)
      ) {
        setIsConfirmOpen(false);
        setDeleteError(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsConfirmOpen(false);
        setDeleteError(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isConfirmOpen]);

  function handleOpenConfirm() {
    setDeleteError(null);
    setIsConfirmOpen(true);
  }

  async function handleDeleteChapter() {
    setDeleteError(null);

    const result = await deleteChapterAction.executeAsync({
      storyId,
      chapterId: chapter.id,
    });

    if (result.data) {
      setIsConfirmOpen(false);
      onDeleted(result.data.id, result.data.updatedAt);
      return;
    }

    setDeleteError(
      result.validationErrors?.formErrors[0] ??
        result.serverError?.message ??
        "The chapter could not be deleted.",
    );
    setIsConfirmOpen(true);
  }

  const handleTriggerClick = hasContent
    ? handleOpenConfirm
    : handleDeleteChapter;

  const shouldShowPopover = isConfirmOpen || Boolean(deleteError);

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        aria-expanded={shouldShowPopover || undefined}
        aria-label={`Delete ${chapter.name}`}
        className="size-8 opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        loading={deleteChapterAction.isPending}
        onClick={handleTriggerClick}
        size="icon"
        title={`Delete ${chapter.name}`}
        type="button"
        variant="ghost"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </Button>

      {shouldShowPopover ? (
        <div className="absolute top-full right-0 z-20 mt-2 w-72 rounded-md border border-border/80 bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="grid gap-2">
            <h4 className="text-label">Delete chapter?</h4>
            <p className="text-body text-muted-foreground">
              {hasContent
                ? "This chapter has content. Deleting it will remove the chapter text from this story."
                : "The chapter could not be deleted. You can try again."}
            </p>
            {deleteError ? (
              <p
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
                role="alert"
              >
                {deleteError}
              </p>
            ) : null}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              onClick={() => {
                setIsConfirmOpen(false);
                setDeleteError(null);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              leftSection={<Trash2 aria-hidden="true" />}
              loading={deleteChapterAction.isPending}
              onClick={handleDeleteChapter}
              size="sm"
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saved") {
    return null;
  }

  const Icon = state === "error" ? CircleAlert : Circle;

  return (
    <output
      aria-label={SAVE_STATE_LABELS[state]}
      aria-live="polite"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center",
        state === "error" ? "text-destructive" : "text-muted-foreground/70",
      )}
      title={SAVE_STATE_LABELS[state]}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          state === "error" ? "size-3" : "size-2 fill-current stroke-none",
        )}
      />
    </output>
  );
}

function RichTextContentEditable({ chapterName }: { chapterName: string }) {
  return (
    <ContentEditable
      aria-label={`${chapterName} content`}
      aria-multiline
      aria-placeholder="Start writing"
      className="min-h-72 px-1 py-3 font-content text-[1.125rem] leading-8 text-foreground/95 outline-none selection:bg-primary selection:text-primary-foreground"
      placeholder={
        <span className="pointer-events-none absolute top-3 left-1 select-none font-content text-[1.125rem] leading-8 text-muted-foreground">
          Start writing
        </span>
      }
      spellCheck
    />
  );
}

type ChapterAutosavePluginProps = {
  chapterId: string;
  initialContent: string;
  isActive: boolean;
  onIndexed: (chapter: StoryChapterIndexSnapshot) => void;
  onSaved: (chapter: StoryChapterItem) => void;
  onSaveStateChange: (state: SaveState) => void;
  storyId: string;
};

function ChapterAutosavePlugin({
  chapterId,
  initialContent,
  isActive,
  onIndexed,
  onSaved,
  onSaveStateChange,
  storyId,
}: ChapterAutosavePluginProps) {
  const { executeAsync } = useAction(updateChapterContent);
  const { executeAsync: executeIndexChapter } = useAction(indexChapter);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indexTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedContentRef = useRef(initialContent);
  const latestContentRef = useRef(initialContent);
  const changeVersionRef = useRef(0);
  const inFlightSavesRef = useRef(0);
  const isMountedRef = useRef(true);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const wasActiveRef = useRef(isActive);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearIndexTimer = useCallback(() => {
    if (indexTimerRef.current) {
      clearTimeout(indexTimerRef.current);
      indexTimerRef.current = null;
    }
  }, []);

  const fireIndexNow = useCallback(
    (triggerReason: ChapterIndexTriggerReason) => {
      clearIndexTimer();
      void executeIndexChapter({
        storyId,
        chapterId,
        triggerReason,
      })
        .then((result) => {
          if (isMountedRef.current && result?.data?.chapter) {
            onIndexed(result.data.chapter);
          }
        })
        .catch(() => null);
    },
    [chapterId, clearIndexTimer, executeIndexChapter, onIndexed, storyId],
  );

  const scheduleIndex = useCallback(() => {
    clearIndexTimer();
    indexTimerRef.current = setTimeout(() => {
      indexTimerRef.current = null;
      fireIndexNow("autosave-debounce");
    }, INDEX_DELAY_MS);
  }, [clearIndexTimer, fireIndexNow]);

  const saveContent = useCallback(
    async (
      content: string,
      version: number,
      options: {
        fireIndexImmediately?: boolean;
        scheduleIndex?: boolean;
        triggerReason?: ChapterIndexTriggerReason;
        updateState: boolean;
      },
    ): Promise<boolean> => {
      inFlightSavesRef.current += 1;
      if (options.updateState) {
        onSaveStateChange("saving");
      }

      const result = await executeAsync({
        storyId,
        chapterId,
        content,
      })
        .catch(() => null)
        .finally(() => {
          inFlightSavesRef.current -= 1;
        });

      if (!result?.data) {
        if (
          options.updateState &&
          isMountedRef.current &&
          version === changeVersionRef.current
        ) {
          onSaveStateChange("error");
        }
        return false;
      }

      if (version !== changeVersionRef.current) {
        return true;
      }

      lastSavedContentRef.current = result.data.content;

      if (options.updateState && isMountedRef.current) {
        onSaved(result.data);
        onSaveStateChange(
          latestContentRef.current === result.data.content
            ? "saved"
            : "pending",
        );
      }

      if (options.fireIndexImmediately && options.triggerReason) {
        fireIndexNow(options.triggerReason);
      } else if (options.scheduleIndex) {
        scheduleIndex();
      }

      return true;
    },
    [
      chapterId,
      executeAsync,
      fireIndexNow,
      onSaved,
      onSaveStateChange,
      scheduleIndex,
      storyId,
    ],
  );

  const enqueueSave = useCallback(
    (
      content: string,
      version: number,
      options: Parameters<typeof saveContent>[2],
    ) => {
      const savePromise = saveQueueRef.current
        .catch(() => false)
        .then(() => saveContent(content, version, options));

      saveQueueRef.current = savePromise;

      return savePromise;
    },
    [saveContent],
  );

  const queueSave = useCallback(
    (content: string, version: number) => {
      clearSaveTimer();
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void enqueueSave(content, version, {
          scheduleIndex: true,
          updateState: true,
        });
      }, AUTOSAVE_DELAY_MS);
    },
    [clearSaveTimer, enqueueSave],
  );

  const flushPendingWork = useCallback(
    async (triggerReason: ChapterIndexTriggerReason, updateState: boolean) => {
      const hadIndexTimer = indexTimerRef.current !== null;

      clearSaveTimer();
      clearIndexTimer();

      if (latestContentRef.current !== lastSavedContentRef.current) {
        await enqueueSave(latestContentRef.current, changeVersionRef.current, {
          fireIndexImmediately: true,
          triggerReason,
          updateState,
        });
        return;
      }

      if (hadIndexTimer) {
        fireIndexNow(triggerReason);
      }
    },
    [clearIndexTimer, clearSaveTimer, enqueueSave, fireIndexNow],
  );

  const flushPendingWorkRef = useRef(flushPendingWork);

  useEffect(() => {
    flushPendingWorkRef.current = flushPendingWork;
  }, [flushPendingWork]);

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      void flushPendingWork("chapter-switch", true);
    }

    wasActiveRef.current = isActive;
  }, [flushPendingWork, isActive]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      void flushPendingWorkRef.current("editor-unmount", false);
      isMountedRef.current = false;
    };
  }, []);

  const handleChange = useCallback(
    (editorState: EditorState, _editor: unknown, tags: Set<string>) => {
      if (tags.has(AI_DRAFT_UPDATE_TAG)) {
        return;
      }

      let markdown = "";

      editorState.read(() => {
        markdown = $convertToMarkdownString(
          CHAPTER_MARKDOWN_TRANSFORMERS,
          undefined,
          true,
        );
      });

      latestContentRef.current = markdown;
      changeVersionRef.current += 1;

      if (
        markdown === lastSavedContentRef.current &&
        inFlightSavesRef.current === 0
      ) {
        clearSaveTimer();
        onSaveStateChange("saved");
        return;
      }

      onSaveStateChange("pending");
      queueSave(markdown, changeVersionRef.current);
    },
    [clearSaveTimer, onSaveStateChange, queueSave],
  );

  return <OnChangePlugin ignoreSelectionChange onChange={handleChange} />;
}
