"use client";

import {
  $convertSelectionToMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $nodesOfType,
  DecoratorNode,
  type EditorConfig,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type PointType,
  type RangeSelection,
  type SerializedLexicalNode,
} from "lexical";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Quote,
  RefreshCw,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";
import { CHAPTER_MARKDOWN_TRANSFORMERS } from "@/components/story-editor/chapter-markdown";
import { cn } from "@/lib/util";

export const AI_DRAFT_UPDATE_TAG = "localink-ai-draft";
export const AI_DRAFT_INLINE_ACTION_EVENT = "localink-ai-draft-inline-action";

export type AiDraftStatus = "streaming" | "stopped" | "complete" | "error";

export type AiDraftInlineAction =
  | {
      action: "accept";
      draftId: string;
      text: string;
    }
  | {
      action: "regenerate";
      draftId: string;
      instructions: string;
      text: string;
    }
  | {
      action: "select";
      draftId: string;
      index: number;
      status: AiDraftStatus;
      text: string;
    }
  | {
      action: "pin-voice";
      draftId: string;
      text: string;
    }
  | {
      action: "reject";
      draftId: string;
    };

export type ChapterAiDraftSnapshot = {
  atChapterEnd: boolean;
  beforeText: string;
  content: string;
  draftId: string;
  afterText: string;
  selectedText: string;
};

export type ChapterAiDraftInsertionContext = {
  atChapterEnd: boolean;
  beforeText: string;
  content: string;
  afterText: string;
  selectedText: string;
};

export type ChapterAiDraftHandle = {
  acceptDraft: (draftId: string, text: string) => void;
  beginDraftVersion: (draftId: string) => void;
  createDraftSnapshot: () => ChapterAiDraftSnapshot | null;
  readInsertionContext: (
    draftId: string,
  ) => ChapterAiDraftInsertionContext | null;
  removeDraft: (draftId: string) => void;
  restoreRewriteSelection: (draftId: string, markdown: string) => void;
  selectDraftVersion: (draftId: string, index: number) => void;
  setContentEditable: (isEditable: boolean) => void;
  updateDraft: (
    draftId: string,
    text: string,
    status: AiDraftStatus,
    promptSnapshotId?: string,
  ) => void;
};

type AiDraftVersion = {
  promptSnapshotId?: string;
  status: AiDraftStatus;
  text: string;
};

type SerializedAiDraftVersion = {
  promptSnapshotId?: string;
  status?: AiDraftStatus;
  text?: string;
};

type SerializedAiDraftNode = SerializedLexicalNode & {
  activeDraftIndex?: number;
  draftId: string;
  drafts?: SerializedAiDraftVersion[];
  status?: AiDraftStatus;
  text?: string;
};

type MarkdownSegment = {
  bold: boolean;
  italic: boolean;
  text: string;
};

type MarkdownFormat = Pick<MarkdownSegment, "bold" | "italic">;

type StoryProsePromptSnapshot = {
  approximateLength: 200 | 400 | 600 | 1000 | "unlimited";
  createdAt: string;
  id: string;
  mode: "first-generation" | "fresh-alternative" | "revise-prior-draft";
  prompt: string;
  system: string;
};

const PLAIN_MARKDOWN_FORMAT = {
  bold: false,
  italic: false,
} satisfies MarkdownFormat;

const MARKDOWN_EMPHASIS_MARKERS = [
  {
    format: { bold: true, italic: true },
    marker: "***",
  },
  {
    format: { bold: true, italic: true },
    marker: "___",
  },
  {
    format: { bold: true, italic: false },
    marker: "**",
  },
  {
    format: { bold: true, italic: false },
    marker: "__",
  },
  {
    format: { bold: false, italic: true },
    marker: "*",
  },
  {
    format: { bold: false, italic: true },
    marker: "_",
  },
] satisfies Array<{ format: MarkdownFormat; marker: string }>;

const AI_DRAFT_STATUSES = new Set<AiDraftStatus>([
  "streaming",
  "stopped",
  "complete",
  "error",
]);

function normalizeDraftVersions(
  drafts: SerializedAiDraftVersion[],
): AiDraftVersion[] {
  const normalizedDrafts = drafts.map((draft) => ({
    promptSnapshotId:
      typeof draft.promptSnapshotId === "string" &&
      draft.promptSnapshotId.trim()
        ? draft.promptSnapshotId
        : undefined,
    status: isAiDraftStatus(draft.status) ? draft.status : "streaming",
    text: typeof draft.text === "string" ? draft.text : "",
  }));

  if (normalizedDrafts.length) {
    return normalizedDrafts;
  }

  return [
    {
      status: "streaming",
      text: "",
    },
  ];
}

function isAiDraftStatus(status: unknown): status is AiDraftStatus {
  return (
    typeof status === "string" && AI_DRAFT_STATUSES.has(status as AiDraftStatus)
  );
}

function clampDraftIndex(index: number, draftCount: number) {
  if (draftCount <= 0 || !Number.isFinite(index)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(index), 0), draftCount - 1);
}

export class AiDraftNode extends DecoratorNode<ReactNode> {
  __activeDraftIndex: number;
  __draftId: string;
  __drafts: AiDraftVersion[];

  static getType(): string {
    return "ai-draft";
  }

  static clone(node: AiDraftNode): AiDraftNode {
    return new AiDraftNode(
      node.__draftId,
      node.__drafts,
      node.__activeDraftIndex,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedAiDraftNode): AiDraftNode {
    return new AiDraftNode(
      serializedNode.draftId,
      serializedNode.drafts ?? [
        {
          status: serializedNode.status,
          text: serializedNode.text,
        },
      ],
      serializedNode.activeDraftIndex ?? 0,
    );
  }

  constructor(
    draftId: string,
    drafts: SerializedAiDraftVersion[] = [
      {
        status: "streaming",
        text: "",
      },
    ],
    activeDraftIndex = 0,
    key?: NodeKey,
  ) {
    super(key);
    this.__draftId = draftId;
    this.__drafts = normalizeDraftVersions(drafts);
    this.__activeDraftIndex = clampDraftIndex(
      activeDraftIndex,
      this.__drafts.length,
    );
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactNode {
    return (
      <AiDraftInlineView
        activeDraftIndex={this.__activeDraftIndex}
        draftId={this.__draftId}
        drafts={this.__drafts}
      />
    );
  }

  exportJSON(): SerializedAiDraftNode {
    return {
      ...super.exportJSON(),
      activeDraftIndex: this.__activeDraftIndex,
      draftId: this.__draftId,
      drafts: this.__drafts,
      status: this.getActiveDraftStatus(),
      text: this.getActiveDraftText(),
    };
  }

  getDraftId(): string {
    return this.__draftId;
  }

  getTextContent(): string {
    return "";
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  beginDraftVersion(): this {
    const writable = this.getWritable();

    writable.__drafts = [
      ...writable.__drafts,
      {
        status: "streaming",
        text: "",
      },
    ];
    writable.__activeDraftIndex = writable.__drafts.length - 1;

    return writable;
  }

  getActiveDraftStatus(): AiDraftStatus {
    return this.__drafts[this.__activeDraftIndex]?.status ?? "streaming";
  }

  getActiveDraftText(): string {
    return this.__drafts[this.__activeDraftIndex]?.text ?? "";
  }

  setActiveDraftIndex(index: number): this {
    const writable = this.getWritable();

    writable.__activeDraftIndex = clampDraftIndex(
      index,
      writable.__drafts.length,
    );

    return writable;
  }

  setDraftContent(
    text: string,
    status: AiDraftStatus,
    promptSnapshotId?: string,
  ): this {
    const writable = this.getWritable();
    const drafts: AiDraftVersion[] = writable.__drafts.length
      ? [...writable.__drafts]
      : [
          {
            status: "streaming",
            text: "",
          },
        ];
    const activeDraftIndex = clampDraftIndex(
      writable.__activeDraftIndex,
      drafts.length,
    );

    drafts[activeDraftIndex] = {
      promptSnapshotId:
        promptSnapshotId || drafts[activeDraftIndex]?.promptSnapshotId,
      status,
      text,
    };
    writable.__activeDraftIndex = activeDraftIndex;
    writable.__drafts = drafts;

    return writable;
  }
}

export function $createAiDraftNode(draftId: string): AiDraftNode {
  return new AiDraftNode(draftId);
}

export function $isAiDraftNode(
  node: LexicalNode | null | undefined,
): node is AiDraftNode {
  return node instanceof AiDraftNode;
}

type ChapterAiDraftPluginProps = {
  chapterId: string;
  onRegister: (chapterId: string, handle: ChapterAiDraftHandle | null) => void;
  onSelectionChange: (chapterId: string, hasSelectedText: boolean) => void;
};

export function ChapterAiDraftPlugin({
  chapterId,
  onRegister,
  onSelectionChange,
}: ChapterAiDraftPluginProps) {
  const [editor] = useLexicalComposerContext();

  const handle = useMemo<ChapterAiDraftHandle>(() => {
    function spliceDraftText(draftId: string, text: string) {
      editor.update(() => {
        const draftNode = getAiDraftNode(draftId);

        if (!draftNode) {
          return;
        }

        const acceptedText = normalizeDraftText(text);

        if (!acceptedText) {
          removeAiDraftNode(draftId);
          return;
        }

        replaceAiDraftWithAcceptedText(draftNode, acceptedText);
      });
    }

    return {
      acceptDraft: spliceDraftText,
      beginDraftVersion(draftId) {
        editor.update(
          () => {
            const draftNode = getAiDraftNode(draftId);

            if (!draftNode) {
              return;
            }

            draftNode.beginDraftVersion();
          },
          { tag: AI_DRAFT_UPDATE_TAG },
        );
      },
      createDraftSnapshot() {
        let snapshot: ChapterAiDraftSnapshot | null = null;

        editor.update(
          () => {
            // Clear stale draft nodes before serializing, so an orphaned
            // draft's text cannot leak into the manuscript context.
            removeAiDraftNodes();

            const selection = prepareInsertionSelection();
            const split = getSelectionMarkdownSplit(selection);
            const draftId = createDraftId();

            insertAiDraftNode(selection, draftId);

            snapshot = {
              atChapterEnd: split.atChapterEnd,
              beforeText: split.beforeText,
              content: split.content,
              draftId,
              afterText: split.afterText,
              selectedText: split.selectedText,
            };
          },
          { discrete: true, tag: AI_DRAFT_UPDATE_TAG },
        );

        return snapshot;
      },
      readInsertionContext(draftId) {
        let insertionContext: ChapterAiDraftInsertionContext | null = null;

        editor.getEditorState().read(() => {
          insertionContext = readDraftNodeInsertionContext(draftId);
        });

        return insertionContext;
      },
      removeDraft(draftId) {
        editor.update(
          () => {
            removeAiDraftNode(draftId);
          },
          { tag: AI_DRAFT_UPDATE_TAG },
        );
      },
      /**
       * Puts back prose that a rewrite draft displaced.
       *
       * Starting a rewrite removes the selected span, because the draft node
       * takes its place so the writer sees the replacement where it will
       * land. Rejecting therefore has to restore it, which is the same
       * splice `acceptDraft` performs with the original Markdown.
       */
      restoreRewriteSelection: spliceDraftText,
      selectDraftVersion(draftId, index) {
        editor.update(
          () => {
            const draftNode = getAiDraftNode(draftId);

            if (!draftNode) {
              return;
            }

            draftNode.setActiveDraftIndex(index);
          },
          { tag: AI_DRAFT_UPDATE_TAG },
        );
      },
      setContentEditable(isEditable) {
        editor.setEditable(isEditable);
      },
      updateDraft(draftId, text, status, promptSnapshotId) {
        editor.update(
          () => {
            const draftNode = getAiDraftNode(draftId);

            if (!draftNode) {
              return;
            }

            draftNode.setDraftContent(text, status, promptSnapshotId);
          },
          { tag: AI_DRAFT_UPDATE_TAG },
        );
      },
    };
  }, [editor]);

  useEffect(() => {
    onRegister(chapterId, handle);

    return () => {
      handle.setContentEditable(true);
      onRegister(chapterId, null);
    };
  }, [chapterId, handle, onRegister]);

  // Lets the generation widget say "Rewrite selection" instead of "Generate"
  // when a range is selected, so the writer knows which of the two a press
  // will do before pressing it.
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();

          onSelectionChange(
            chapterId,
            $isRangeSelection(selection) &&
              !selection.isCollapsed() &&
              selection.getTextContent().trim().length > 0,
          );
        });
      }),
    [chapterId, editor, onSelectionChange],
  );

  return null;
}

function AiDraftInlineView({
  activeDraftIndex,
  draftId,
  drafts,
}: {
  activeDraftIndex: number;
  draftId: string;
  drafts: AiDraftVersion[];
}) {
  const [regenerationInstructions, setRegenerationInstructions] = useState("");
  const activeDraft = drafts[activeDraftIndex] ?? {
    status: "streaming",
    text: "",
  };
  const status = activeDraft.status;
  const text = activeDraft.text;
  const canReview = status !== "streaming";
  const canSelectPrevious = activeDraftIndex > 0;
  const canSelectNext = activeDraftIndex < drafts.length - 1;
  const hasDraftText = text.trim().length > 0;
  const previewText = hasDraftText ? text : getDraftPlaceholder(status);

  function handleRegenerate() {
    const nextInstructions = regenerationInstructions;

    setRegenerationInstructions("");
    dispatchAiDraftInlineAction({
      action: "regenerate",
      draftId,
      instructions: nextInstructions,
      text,
    });
  }

  function handleSelectDraft(index: number) {
    const draft = drafts[index];

    if (!draft) {
      return;
    }

    dispatchAiDraftInlineAction({
      action: "select",
      draftId,
      index,
      status: draft.status,
      text: draft.text,
    });
  }

  return (
    <span
      className={cn(
        "my-2 block w-full rounded-sm border-primary/55 border-l-2 bg-primary/10 px-3 py-2 text-foreground",
        status === "error" && "border-destructive/45 bg-destructive/10",
      )}
      contentEditable={false}
      data-ai-draft-id={draftId}
    >
      {status === "streaming" && !hasDraftText ? (
        <GeneratingDraftPreview />
      ) : (
        <span className="block w-full whitespace-pre-wrap font-content text-[1.125rem] leading-8">
          <MarkdownPreview text={previewText} />
          {status === "streaming" ? (
            <span
              aria-hidden="true"
              className="ml-1 inline-block h-5 w-1 animate-pulse rounded-sm bg-primary/70 align-text-bottom"
            />
          ) : null}
        </span>
      )}

      {canReview ? (
        <span className="mt-2 flex flex-col gap-2 border-border/70 border-t pt-2 sm:flex-row">
          {drafts.length > 1 ? (
            <span className="flex shrink-0 items-center gap-1">
              <button
                aria-label="Previous AI draft"
                className="inline-flex size-7 items-center justify-center rounded-sm border border-border/70 bg-background/60 text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                disabled={!canSelectPrevious}
                onClick={() => handleSelectDraft(activeDraftIndex - 1)}
                title="Previous draft"
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="size-3" />
              </button>
              <span className="min-w-8 text-center font-sans text-caption text-muted-foreground">
                {activeDraftIndex + 1}/{drafts.length}
              </span>
              <button
                aria-label="Next AI draft"
                className="inline-flex size-7 items-center justify-center rounded-sm border border-border/70 bg-background/60 text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
                disabled={!canSelectNext}
                onClick={() => handleSelectDraft(activeDraftIndex + 1)}
                title="Next draft"
                type="button"
              >
                <ChevronRight aria-hidden="true" className="size-3" />
              </button>
            </span>
          ) : null}
          <input
            aria-label="Regeneration instructions"
            className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background/55 px-2 py-1 font-sans text-caption text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:ring-[2px] focus-visible:ring-ring/35"
            maxLength={1000}
            onChange={(event) =>
              setRegenerationInstructions(event.target.value)
            }
            placeholder="Optional regeneration instructions"
            value={regenerationInstructions}
          />
          <button
            aria-label="Regenerate AI draft"
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 font-sans text-caption text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none"
            onClick={handleRegenerate}
            title="Regenerate"
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-3" />
            Regenerate
          </button>
          {activeDraft.promptSnapshotId ? (
            <PromptSnapshotDialogButton
              promptSnapshotId={activeDraft.promptSnapshotId}
            />
          ) : null}
          <button
            aria-label="Pin AI draft as a voice sample"
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 font-sans text-caption text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            disabled={!text.trim()}
            onClick={() =>
              dispatchAiDraftInlineAction({
                action: "pin-voice",
                draftId,
                text,
              })
            }
            title="Pin as a voice sample for this story"
            type="button"
          >
            <Quote aria-hidden="true" className="size-3" />
            Pin voice
          </button>
          <button
            aria-label="Reject AI draft"
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 font-sans text-caption text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none"
            onClick={() =>
              dispatchAiDraftInlineAction({ action: "reject", draftId })
            }
            title="Reject"
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
            Reject
          </button>
          <button
            aria-label="Accept AI draft"
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-primary/35 bg-primary px-2 font-sans text-caption text-primary-foreground transition-[background-color,border-color] hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            disabled={!text.trim()}
            onClick={() =>
              dispatchAiDraftInlineAction({
                action: "accept",
                draftId,
                text,
              })
            }
            title="Accept"
            type="button"
          >
            <Check aria-hidden="true" className="size-3" />
            Accept
          </button>
        </span>
      ) : null}
    </span>
  );
}

function PromptSnapshotDialogButton({
  promptSnapshotId,
}: {
  promptSnapshotId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptSnapshot, setPromptSnapshot] =
    useState<StoryProsePromptSnapshot | null>(null);

  async function loadPromptSnapshot() {
    if (promptSnapshot?.id === promptSnapshotId) {
      return;
    }

    setIsLoading(true);
    setPromptError(null);

    try {
      const response = await fetch(
        `/api/story-prose/prompts/${encodeURIComponent(promptSnapshotId)}`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(await readPromptSnapshotError(response));
      }

      const data = (await response.json()) as StoryProsePromptSnapshot;

      setPromptSnapshot(data);
    } catch (error) {
      const message = getPromptSnapshotFailureMessage(error);

      setPromptError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleOpenChange(nextIsOpen: boolean) {
    setIsOpen(nextIsOpen);

    if (nextIsOpen) {
      void loadPromptSnapshot();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <button
        aria-label="View AI prompts"
        className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-border/70 bg-background/60 px-2 font-sans text-caption text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/35 focus-visible:outline-none"
        onClick={() => handleOpenChange(true)}
        title="Prompts"
        type="button"
      >
        <FileText aria-hidden="true" className="size-3" />
        Prompts
      </button>
      <DialogContent className="max-h-[85vh] max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0">
        <DialogHeader className="border-border/80 border-b px-4 pt-4 pr-12 pb-3">
          <DialogTitle className="text-heading">Generation prompts</DialogTitle>
          <DialogDescription className="sr-only">
            Full system and request prompts used to generate this draft version.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <p className="py-4 text-body text-muted-foreground">
              Loading prompts...
            </p>
          ) : promptError ? (
            <p className="py-4 text-body text-destructive" role="alert">
              {promptError}
            </p>
          ) : promptSnapshot ? (
            <div className="grid gap-4 pt-4">
              <PromptSnapshotBlock
                title="System"
                value={promptSnapshot.system}
              />
              <PromptSnapshotBlock
                title="Request"
                value={promptSnapshot.prompt}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PromptSnapshotBlock({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <section className="grid gap-2">
      <h3 className="font-sans text-label text-muted-foreground">{title}</h3>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border/80 bg-background/70 p-3 font-mono text-[0.75rem] leading-5">
        {value}
      </pre>
    </section>
  );
}

async function readPromptSnapshotError(response: Response) {
  try {
    const data = (await response.json()) as { message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    return "The prompts for this draft could not be loaded.";
  }

  return "The prompts for this draft could not be loaded.";
}

function getPromptSnapshotFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "The prompts for this draft could not be loaded.";
}

function GeneratingDraftPreview() {
  return (
    <output aria-label="Generating AI draft" className="block w-full py-1">
      <span className="block h-4 w-11/12 animate-pulse rounded-sm bg-primary/25" />
      <span className="mt-3 block h-4 w-10/12 animate-pulse rounded-sm bg-primary/20" />
      <span className="mt-3 block h-4 w-2/3 animate-pulse rounded-sm bg-primary/15" />
    </output>
  );
}

function MarkdownPreview({ text }: { text: string }) {
  const blocks = splitMarkdownBlocks(text);

  return (
    <>
      {blocks.map((block, blockIndex) => (
        // Composite index+content keys are stable for this fully re-rendered,
        // stateless markdown preview; index guards against duplicate text.
        // biome-ignore lint/suspicious/noArrayIndexKey: static presentational text
        <span className="mb-5 block last:mb-0" key={`${blockIndex}-${block}`}>
          {block.split("\n").map((line, lineIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static presentational text
            <span key={`${lineIndex}-${line}`}>
              {lineIndex > 0 ? <br /> : null}
              {parseMarkdownInline(line).map((segment, segmentIndex) => {
                const key = `${segmentIndex}-${segment.text}`;

                if (segment.bold && segment.italic) {
                  return (
                    <strong className="font-semibold italic" key={key}>
                      {segment.text}
                    </strong>
                  );
                }

                if (segment.bold) {
                  return (
                    <strong className="font-semibold" key={key}>
                      {segment.text}
                    </strong>
                  );
                }

                if (segment.italic) {
                  return (
                    <em className="italic" key={key}>
                      {segment.text}
                    </em>
                  );
                }

                return <span key={key}>{segment.text}</span>;
              })}
            </span>
          ))}
        </span>
      ))}
    </>
  );
}

function dispatchAiDraftInlineAction(detail: AiDraftInlineAction) {
  window.dispatchEvent(
    new CustomEvent<AiDraftInlineAction>(AI_DRAFT_INLINE_ACTION_EVENT, {
      detail,
    }),
  );
}

function getDraftPlaceholder(status: AiDraftStatus) {
  if (status === "error") {
    return "Draft failed";
  }

  if (status === "stopped") {
    return "Draft stopped";
  }

  return "Generating...";
}

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`;
}

function normalizeDraftText(text: string) {
  return text.replace(/\r\n?/g, "\n").trim();
}

function replaceAiDraftWithAcceptedText(
  draftNode: AiDraftNode,
  markdown: string,
) {
  const acceptedNodes = createMarkdownParagraphNodes(markdown);

  if (!acceptedNodes.length) {
    draftNode.remove();
    return;
  }

  const parent = draftNode.getParent();

  if (
    $isElementNode(parent) &&
    $isRootNode(parent.getParent()) &&
    parent.getChildrenSize() > 1
  ) {
    replaceEmbeddedAiDraftWithAcceptedText(draftNode, parent, acceptedNodes);
    return;
  }

  const replaceTarget =
    $isElementNode(parent) && parent.getChildrenSize() === 1
      ? parent
      : draftNode;
  const [firstNode, ...remainingNodes] = acceptedNodes;
  let insertedNode: LexicalNode = replaceTarget.replace(firstNode);

  for (const node of remainingNodes) {
    insertedNode = insertedNode.insertAfter(node);
  }

  insertedNode.selectEnd();
}

function replaceEmbeddedAiDraftWithAcceptedText(
  draftNode: AiDraftNode,
  parent: ElementNode,
  acceptedNodes: LexicalNode[],
) {
  if (acceptedNodes.length === 1) {
    replaceAiDraftWithInlineChildren(draftNode, acceptedNodes[0]);
    return;
  }

  const afterNodes = draftNode.getNextSiblings();
  const afterParagraph =
    afterNodes.length > 0 ? $createParagraphNode().append(...afterNodes) : null;

  draftNode.remove();

  let insertedNode: LexicalNode = parent;

  if (parent.isEmpty()) {
    const [firstNode, ...remainingNodes] = acceptedNodes;

    insertedNode = parent.replace(firstNode);

    for (const node of remainingNodes) {
      insertedNode = insertedNode.insertAfter(node);
    }
  } else {
    for (const node of acceptedNodes) {
      insertedNode = insertedNode.insertAfter(node);
    }
  }

  if (afterParagraph && !afterParagraph.isEmpty()) {
    insertedNode = insertedNode.insertAfter(afterParagraph);
  }

  insertedNode.selectEnd();
}

function replaceAiDraftWithInlineChildren(
  draftNode: AiDraftNode,
  acceptedParagraph: LexicalNode,
) {
  if (!$isElementNode(acceptedParagraph)) {
    draftNode.replace(acceptedParagraph).selectEnd();
    return;
  }

  const acceptedChildren = acceptedParagraph.getChildren();

  if (!acceptedChildren.length) {
    draftNode.remove();
    return;
  }

  const [firstChild, ...remainingChildren] = acceptedChildren;
  let insertedNode = draftNode.replace(firstChild);

  for (const node of remainingChildren) {
    insertedNode = insertedNode.insertAfter(node);
  }

  insertedNode.selectEnd();
}

function createMarkdownParagraphNodes(markdown: string) {
  return splitMarkdownBlocks(markdown).map((block) => {
    const paragraph = $createParagraphNode();
    const lines = block.split("\n");

    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        paragraph.append($createLineBreakNode());
      }

      paragraph.append(...createMarkdownTextNodes(line));
    });

    return paragraph;
  });
}

function createMarkdownTextNodes(text: string) {
  return parseMarkdownInline(text).map((segment) => {
    const textNode = $createTextNode(segment.text);

    if (segment.bold) {
      textNode.toggleFormat("bold");
    }

    if (segment.italic) {
      textNode.toggleFormat("italic");
    }

    return textNode;
  });
}

function splitMarkdownBlocks(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseMarkdownInline(
  text: string,
  activeFormat: MarkdownFormat = PLAIN_MARKDOWN_FORMAT,
): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let buffer = "";
  let index = 0;

  function flushBuffer() {
    if (!buffer) {
      return;
    }

    segments.push({
      ...activeFormat,
      text: buffer,
    });
    buffer = "";
  }

  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }

    const marker = MARKDOWN_EMPHASIS_MARKERS.find((candidate) =>
      text.startsWith(candidate.marker, index),
    );

    if (!marker) {
      buffer += text[index];
      index += 1;
      continue;
    }

    const contentStart = index + marker.marker.length;
    const contentEnd = text.indexOf(marker.marker, contentStart);

    if (contentEnd <= contentStart) {
      buffer += marker.marker;
      index += marker.marker.length;
      continue;
    }

    flushBuffer();
    segments.push(
      ...parseMarkdownInline(text.slice(contentStart, contentEnd), {
        bold: activeFormat.bold || marker.format.bold,
        italic: activeFormat.italic || marker.format.italic,
      }),
    );
    index = contentEnd + marker.marker.length;
  }

  flushBuffer();

  return mergeAdjacentMarkdownSegments(segments);
}

function mergeAdjacentMarkdownSegments(segments: MarkdownSegment[]) {
  return segments.reduce<MarkdownSegment[]>((mergedSegments, segment) => {
    const previousSegment = mergedSegments.at(-1);

    if (
      previousSegment &&
      previousSegment.bold === segment.bold &&
      previousSegment.italic === segment.italic
    ) {
      previousSegment.text += segment.text;
      return mergedSegments;
    }

    mergedSegments.push({ ...segment });
    return mergedSegments;
  }, []);
}

function getAiDraftNode(draftId: string): AiDraftNode | null {
  return (
    $nodesOfType(AiDraftNode).find((node) => node.getDraftId() === draftId) ??
    null
  );
}

/**
 * Puts the draft node where the generated prose will land.
 *
 * For a rewrite the selection is not collapsed, and Lexical's `insertNodes`
 * removes the selected content before inserting — which is what should
 * happen: the draft stands in the place of the prose it replaces, and
 * rejecting restores the original from the snapshot.
 */
function insertAiDraftNode(selection: RangeSelection | null, draftId: string) {
  const draftNode = $createAiDraftNode(draftId);

  if (
    selection &&
    (isSelectionOnEmptyLine(selection) || isSingleBlockSelection(selection))
  ) {
    selection.insertNodes([draftNode]);
    return;
  }

  const paragraph = $createParagraphNode();
  paragraph.append(draftNode);

  if (selection) {
    selection.insertNodes([paragraph]);
    return;
  }

  $getRoot().append(paragraph);
}

/**
 * True when a rewrite stays inside one block.
 *
 * Those insert the draft inline so the paragraph is not split in two; a
 * selection spanning blocks gets the usual paragraph wrapper.
 */
function isSingleBlockSelection(selection: RangeSelection) {
  if (selection.isCollapsed()) {
    return false;
  }

  const [start, end] = selection.getStartEndPoints() ?? [];

  if (!start || !end) {
    return false;
  }

  const startTopLevel = start.getNode().getTopLevelElement();
  const endTopLevel = end.getNode().getTopLevelElement();

  return Boolean(startTopLevel && endTopLevel && startTopLevel.is(endTopLevel));
}

function isSelectionOnEmptyLine(selection: RangeSelection) {
  const anchorNode = selection.anchor.getNode();
  const topLevel = anchorNode.getTopLevelElement();

  return $isElementNode(topLevel) && topLevel.getTextContentSize() === 0;
}

function removeAiDraftNode(draftId: string) {
  const draftNode = getAiDraftNode(draftId);

  if (!draftNode) {
    return;
  }

  const parent = draftNode.getParent();

  draftNode.remove();

  if ($isElementNode(parent) && parent.isEmpty()) {
    parent.remove();
  }
}

function removeAiDraftNodes() {
  for (const node of $nodesOfType(AiDraftNode)) {
    const parent = node.getParent();

    node.remove();

    if ($isElementNode(parent) && parent.isEmpty()) {
      parent.remove();
    }
  }
}

/**
 * Resolves where the draft goes: the caret, or a selected span to rewrite.
 *
 * A range selection used to be discarded and the caret forced to the chapter
 * end, so selecting a paragraph and generating silently appended somewhere
 * else and accepted prose could never be revised.
 */
function prepareInsertionSelection(): RangeSelection | null {
  const selection = $getSelection();

  if ($isRangeSelection(selection)) {
    return selection;
  }

  selectChapterEnd();

  const endSelection = $getSelection();

  return $isRangeSelection(endSelection) ? endSelection : null;
}

function selectChapterEnd() {
  const root = $getRoot();
  const lastChild = root.getLastChild();

  if ($isElementNode(lastChild)) {
    lastChild.selectEnd();
    return;
  }

  if (lastChild) {
    lastChild.selectEnd();
    return;
  }

  const paragraph = $createParagraphNode();
  root.append(paragraph);
  paragraph.selectEnd();
}

type ChapterMarkdownSplit = {
  atChapterEnd: boolean;
  beforeText: string;
  content: string;
  afterText: string;
  selectedText: string;
};

type ChapterMarkdownPoint = {
  key: NodeKey;
  offset: number;
  type: "element" | "text";
};

/**
 * Splits the chapter at the caret into the Markdown before and after it.
 *
 * Markdown rather than plain text: every other chapter reaches the model as
 * stored Markdown, and the prose prompt asks the model to match the
 * surrounding manuscript's formatting. Serializing the focused chapter as
 * plain text dropped exactly the italics the model was told to match.
 */
function getSelectionMarkdownSplit(
  selection: RangeSelection | null,
): ChapterMarkdownSplit {
  if (!selection) {
    return {
      atChapterEnd: true,
      beforeText: convertChapterToMarkdown(),
      content: convertChapterToMarkdown(),
      afterText: "",
      selectedText: "",
    };
  }

  const root = $getRoot();
  // Ordered, so a selection dragged backwards splits the same as a forward
  // one; for a caret both points are the same.
  const [start, end] = selection.getStartEndPoints() ?? [
    selection.anchor,
    selection.focus,
  ];
  const beforeText = convertChapterRangeToMarkdown(
    getChapterStartPoint(root),
    toChapterMarkdownPoint(start),
  );
  const afterText = convertChapterRangeToMarkdown(
    toChapterMarkdownPoint(end),
    getChapterEndPoint(root),
  );
  const selectedText = selection.isCollapsed()
    ? ""
    : $convertSelectionToMarkdownString(
        CHAPTER_MARKDOWN_TRANSFORMERS,
        selection,
        true,
      ).trim();

  return {
    // A rewrite replaces a span in place, so it is never an append even when
    // the selection runs to the end of the chapter.
    atChapterEnd: !selectedText && afterText.trim().length === 0,
    beforeText,
    content: convertChapterToMarkdown(),
    afterText,
    selectedText,
  };
}

function toChapterMarkdownPoint(point: PointType): ChapterMarkdownPoint {
  return { key: point.key, offset: point.offset, type: point.type };
}

/**
 * The same split, anchored on an existing draft node instead of the caret.
 *
 * Regeneration happens after the caret has moved on, so the draft node itself
 * is the only reliable record of where the prose is going. This keeps a
 * regenerated draft reading current chapter content rather than the snapshot
 * captured when the first version was requested.
 */
function readDraftNodeInsertionContext(
  draftId: string,
): ChapterAiDraftInsertionContext | null {
  const draftNode = getAiDraftNode(draftId);

  if (!draftNode) {
    return null;
  }

  const root = $getRoot();
  const draftTopLevel = draftNode.getTopLevelElement();

  if (!draftTopLevel) {
    return null;
  }

  const draftIndex = draftTopLevel.getIndexWithinParent();
  const beforeText = convertChapterRangeToMarkdown(getChapterStartPoint(root), {
    key: root.getKey(),
    offset: draftIndex,
    type: "element",
  });
  const afterText = convertChapterRangeToMarkdown(
    { key: root.getKey(), offset: draftIndex + 1, type: "element" },
    getChapterEndPoint(root),
  );

  return {
    atChapterEnd: afterText.trim().length === 0,
    beforeText,
    content: [beforeText, afterText].filter(Boolean).join("\n"),
    afterText,
    // The draft node already stands where the rewritten span was, so the
    // selection is not part of the chapter to re-read; the caller carries it
    // forward from the original snapshot.
    selectedText: "",
  };
}

function convertChapterToMarkdown(): string {
  return $convertToMarkdownString(
    CHAPTER_MARKDOWN_TRANSFORMERS,
    undefined,
    true,
  );
}

function convertChapterRangeToMarkdown(
  anchor: ChapterMarkdownPoint,
  focus: ChapterMarkdownPoint,
): string {
  const selection = $createRangeSelection();

  selection.anchor.set(anchor.key, anchor.offset, anchor.type);
  selection.focus.set(focus.key, focus.offset, focus.type);

  // Matches the `shouldPreserveNewLines` used when chapter content is read and
  // written, so the focused chapter separates blocks the same way the stored
  // chapters do.
  return $convertSelectionToMarkdownString(
    CHAPTER_MARKDOWN_TRANSFORMERS,
    selection,
    true,
  );
}

function getChapterStartPoint(root: ElementNode): ChapterMarkdownPoint {
  return { key: root.getKey(), offset: 0, type: "element" };
}

function getChapterEndPoint(root: ElementNode): ChapterMarkdownPoint {
  return {
    key: root.getKey(),
    offset: root.getChildrenSize(),
    type: "element",
  };
}
