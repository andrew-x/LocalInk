"use client";

import { $convertSelectionToMarkdownString } from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useSetConversationOpen } from "@/components/studio/ai-box/use-chat-session";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  dropVoiceTune,
  dropVoiceTunesForMoment,
  registerVoiceTune,
} from "@/components/studio/voice/voice-tune-bridge";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  STUDIO_REWRITE_MAX_SELECTION_CHARS,
  type StudioRewriteMode,
  type StudioRewriteResponse,
} from "@/lib/studio/rewrite-contract";
import { generateId } from "@/lib/util";
import { replaceCapturedSelection } from "./selection-replace";
import {
  AskForm,
  type CapturedSelection,
  RewriteOptions,
  type RewritePanel,
} from "./selection-toolbar-panels";
import { STUDIO_MARKDOWN_TRANSFORMERS } from "./studio-markdown";

const REWRITE_FAILED = "The rewrite could not be generated. Please try again.";
const SELECTION_TOO_LONG =
  "Select a shorter passage (up to 4,000 characters) to rewrite.";
const SELECTION_CHANGED =
  "The selected text changed. Select it again and retry.";

const TOOLBAR_BUTTON_CLASS =
  "rounded-sm px-2 py-1 text-label-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

type Anchor = { top: number; bottom: number; centerX: number };

function rangeAnchor(range: Range | null): Anchor | null {
  if (!range) return null;
  const box = range.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return {
    top: box.top,
    bottom: box.bottom,
    centerX: box.left + box.width / 2,
  };
}

type SelectionToolbarPluginProps = {
  storyId: string;
  momentId: string;
};

/**
 * Floating actions for a non-collapsed selection inside one moment: one AI
 * rewrite shown beside the original, kept or retried from the panel.
 */
export function SelectionToolbarPlugin({
  momentId,
  storyId,
}: SelectionToolbarPluginProps) {
  const [editor] = useLexicalComposerContext();
  const { state, dispatch } = useStudioStore();
  const setConversationOpen = useSetConversationOpen();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [panel, setPanel] = useState<RewritePanel | null>(null);
  const [asking, setAsking] = useState<CapturedSelection | null>(null);
  // "Ask…" and "Voice is off…" share the inline form.
  const [askingVoice, setAskingVoice] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // The last request, so "Try again" repeats it.
  const lastRequestRef = useRef<{
    mode: StudioRewriteMode;
    instruction?: string;
  } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const held = panel?.captured ?? asking;
  // Set synchronously with the panel state: focusing the Ask input blurs the
  // editor before effects run, and the toolbar must not vanish then.
  const heldRef = useRef<CapturedSelection | null>(null);

  const close = useCallback(() => {
    heldRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setPanel(null);
    setAsking(null);
    setAskingVoice(false);
  }, []);

  // Follow the live selection, or the held one while a panel is open.
  useEffect(() => {
    const update = () => {
      const current = heldRef.current;
      if (current) {
        const next = rangeAnchor(current.range);
        if (next) setAnchor(next);
        return;
      }
      // Every moment listens, so bail out cheaply unless this one has focus.
      const root = editor.getRootElement();
      const active = document.activeElement;
      const native = window.getSelection();
      if (
        !root ||
        !(active instanceof Node && root.contains(active)) ||
        !native ||
        native.rangeCount === 0 ||
        !root.contains(native.anchorNode)
      ) {
        setAnchor(null);
        return;
      }
      const hasText = editor.getEditorState().read(() => {
        const selection = $getSelection();
        return (
          $isRangeSelection(selection) &&
          !selection.isCollapsed() &&
          selection.getTextContent().trim().length > 0
        );
      });
      setAnchor(hasText ? rangeAnchor(native.getRangeAt(0)) : null);
    };
    const unregister = editor.registerUpdateListener(update);
    document.addEventListener("selectionchange", update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      unregister();
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [editor]);

  // Escape or a click elsewhere closes an open panel.
  useEffect(() => {
    if (!held) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !toolbarRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const unregisterEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        close();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      unregisterEscape();
    };
  }, [close, editor, held]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A tuning card can only replace a passage whose editor is still mounted.
  useEffect(() => () => dropVoiceTunesForMoment(momentId), [momentId]);

  const capture = useCallback((): CapturedSelection | null => {
    const native = window.getSelection();
    const range =
      native && native.rangeCount > 0
        ? native.getRangeAt(0).cloneRange()
        : null;
    return editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return null;
      const markdown = $convertSelectionToMarkdownString(
        STUDIO_MARKDOWN_TRANSFORMERS,
        selection,
      ).trim();
      if (!markdown) return null;
      return {
        selection: selection.clone(),
        markdown,
        plain: selection.getTextContent(),
        range,
      };
    });
  }, [editor]);

  const requestRewrite = useCallback(
    async (
      mode: StudioRewriteMode,
      captured: CapturedSelection,
      instruction?: string,
    ) => {
      if (captured.markdown.length > STUDIO_REWRITE_MAX_SELECTION_CHARS) {
        toast.error(SELECTION_TOO_LONG);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRequestRef.current = { mode, instruction };
      heldRef.current = captured;
      setAsking(null);
      setPanel({ status: "loading", mode, captured });
      try {
        const response = await postStudioJson<StudioRewriteResponse>(
          "/api/studio/rewrite",
          {
            storyId,
            momentId,
            selectedText: captured.markdown,
            mode,
            ...(instruction ? { instruction } : {}),
          },
          controller.signal,
        );
        if (abortRef.current !== controller) return;
        setPanel({
          status: "ready",
          mode,
          captured,
          options: response.options,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        heldRef.current = null;
        setPanel(null);
        toast.error(studioErrorMessage(error, REWRITE_FAILED));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [momentId, storyId],
  );

  const startRewrite = (mode: Exclude<StudioRewriteMode, "custom">) => {
    const captured = capture();
    if (captured) void requestRewrite(mode, captured);
  };

  const startAsk = (voice = false) => {
    const captured = capture();
    if (!captured) return;
    heldRef.current = captured;
    setAskingVoice(voice);
    setAsking(captured);
  };

  const startVoiceTune = (captured: CapturedSelection, complaint: string) => {
    if (captured.markdown.length > STUDIO_REWRITE_MAX_SELECTION_CHARS) {
      toast.error(SELECTION_TOO_LONG);
      return;
    }
    // One tune at a time: the new one replaces the old.
    if (state.voiceTune) dropVoiceTune(state.voiceTune.id);
    const id = generateId("voice-tune");
    registerVoiceTune({
      id,
      momentId,
      replace: (markdown) => {
        const replaced = replaceCapturedSelection(editor, captured, markdown);
        if (replaced) editor.focus();
        return replaced;
      },
    });
    // The conversation overlay covers the plan pane that holds the card.
    setConversationOpen(false);
    dispatch({
      type: "start-voice-tune",
      tune: {
        id,
        momentId,
        selectedText: captured.markdown,
        complaint,
      },
    });
    close();
  };

  const retryRewrite = () => {
    const last = lastRequestRef.current;
    if (panel?.status !== "ready" || !last) return;
    void requestRewrite(last.mode, panel.captured, last.instruction);
  };

  const keepRewrite = (option: string) => {
    if (panel?.status !== "ready") return;
    const { captured } = panel;
    const replaced = replaceCapturedSelection(editor, captured, option);
    close();
    if (!replaced) toast.error(SELECTION_CHANGED);
    editor.focus();
  };

  if (!anchor) return null;

  const placeAbove = anchor.top > 220;
  const style = {
    left: Math.min(Math.max(anchor.centerX, 180), window.innerWidth - 180),
    top: placeAbove ? anchor.top - 8 : anchor.bottom + 8,
    transform: placeAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  };

  return createPortal(
    <div
      aria-label="Selection actions"
      className="fixed z-50 w-max max-w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border/90 bg-popover p-1 font-sans text-popover-foreground shadow-xl"
      onMouseDown={(event) => {
        // Keep the editor's selection while pressing toolbar buttons.
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
      ref={toolbarRef}
      role="toolbar"
      style={style}
    >
      {panel ? (
        <RewriteOptions
          onClose={close}
          onKeep={keepRewrite}
          onRetry={retryRewrite}
          panel={panel}
        />
      ) : asking ? (
        askingVoice ? (
          <AskForm
            ariaLabel="What's off about how this sounds?"
            onCancel={close}
            onSubmit={(complaint) => startVoiceTune(asking, complaint)}
            placeholder="What's off?"
            submitLabel="Tune"
          />
        ) : (
          <AskForm
            onCancel={close}
            onSubmit={(instruction) =>
              void requestRewrite("custom", asking, instruction)
            }
          />
        )
      ) : (
        <div className="flex items-center gap-0.5">
          <button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startRewrite("rewrite")}
            type="button"
          >
            <span aria-hidden="true" className="mr-1 text-accent">
              ✦
            </span>
            Rewrite
          </button>
          <button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startRewrite("tighten")}
            type="button"
          >
            Tighten
          </button>
          <button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startRewrite("subtext")}
            type="button"
          >
            More subtext
          </button>
          <button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startAsk()}
            type="button"
          >
            Ask…
          </button>
          <button
            className={TOOLBAR_BUTTON_CLASS}
            onClick={() => startAsk(true)}
            type="button"
          >
            Voice is off…
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
