"use client";

import {
  $convertFromMarkdownString,
  $convertSelectionToMarkdownString,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  mergeRegister,
  type PointType,
} from "lexical";
import { useEffect, useRef } from "react";

import type { StudioProseDto } from "@/lib/studio/contracts";

import {
  focusNeighbor,
  type MomentEditorHandle,
  registerMomentEditor,
} from "./editor-registry";
import { STUDIO_MARKDOWN_TRANSFORMERS } from "./studio-markdown";

/** Tags an update that loads prose written elsewhere, so autosave skips it. */
export const STUDIO_EXTERNAL_PROSE_TAG = "studio-external-prose";

type RawPoint = { key: string; offset: number; type: "text" | "element" };

function $rangeToMarkdown(anchor: RawPoint, focus: RawPoint): string {
  const range = $createRangeSelection();
  range.anchor.set(anchor.key, anchor.offset, anchor.type);
  range.focus.set(focus.key, focus.offset, focus.type);
  return $convertSelectionToMarkdownString(
    STUDIO_MARKDOWN_TRANSFORMERS,
    range,
  ).trim();
}

/** Markdown before and after the start of the current selection. */
export function $splitMarkdownAtSelection(): {
  before: string;
  after: string;
} | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const start = selection.isBackward() ? selection.focus : selection.anchor;
  const point: RawPoint = {
    key: start.key,
    offset: start.offset,
    type: start.type,
  };
  const root = $getRoot();
  return {
    before: $rangeToMarkdown(
      { key: root.getKey(), offset: 0, type: "element" },
      point,
    ),
    after: $rangeToMarkdown(point, {
      key: root.getKey(),
      offset: root.getChildrenSize(),
      type: "element",
    }),
  };
}

function $isPointAtEdge(point: PointType, edge: "start" | "end"): boolean {
  const root = $getRoot();
  const node = point.getNode();
  if (edge === "start") {
    if (point.offset !== 0) return false;
    const first = root.getFirstDescendant();
    return (
      first === null ||
      node.is(first) ||
      node.is(root) ||
      node.is(root.getFirstChild())
    );
  }
  const last = root.getLastDescendant();
  if (last === null) return true;
  if ($isTextNode(node)) {
    return node.is(last) && point.offset === node.getTextContentSize();
  }
  return (
    $isElementNode(node) &&
    (node.is(last) || node.is(root) || node.is(root.getLastChild())) &&
    point.offset === node.getChildrenSize()
  );
}

function $isCollapsedAtEdge(edge: "start" | "end"): boolean {
  const selection = $getSelection();
  return (
    $isRangeSelection(selection) &&
    selection.isCollapsed() &&
    $isPointAtEdge(selection.anchor, edge)
  );
}

function $isCollapsed(): boolean {
  const selection = $getSelection();
  return $isRangeSelection(selection) && selection.isCollapsed();
}

function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getClientRects()[0];
  if (rect) return rect;
  // An empty paragraph has no client rects; use its box instead.
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return element?.getBoundingClientRect() ?? null;
}

/** Whether the caret sits on the first or last visual line of the editor. */
function isCaretOnEdgeLine(
  root: HTMLElement | null,
  edge: "first" | "last",
): boolean {
  if (!root) return false;
  const caret = caretRect();
  if (!caret) return false;
  const bounds = root.getBoundingClientRect();
  const lineHeight =
    Number.parseFloat(getComputedStyle(root).lineHeight) || caret.height || 24;
  const threshold = lineHeight * 0.75;
  return edge === "first"
    ? caret.top - bounds.top < threshold
    : bounds.bottom - caret.bottom < threshold;
}

/**
 * Arrow keys at an editor's edges move into the neighbouring moment, so the
 * stack of editors reads and navigates like one text. Shift-extended
 * selections stay inside one moment: cross-moment selection is unsupported.
 */
export function MomentKeyboardPlugin({ registryId }: { registryId: string }) {
  const [editor] = useLexicalComposerContext();
  const idRef = useRef(registryId);
  useEffect(() => {
    idRef.current = registryId;
  }, [registryId]);

  useEffect(() => {
    const navigate = (
      event: KeyboardEvent,
      direction: "prev" | "next",
      edge: "start" | "end",
      isAtEdge: () => boolean,
    ) => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
        return false;
      }
      if (!isAtEdge()) return false;
      if (!focusNeighbor(idRef.current, direction, edge)) return false;
      event.preventDefault();
      return true;
    };
    const root = () => editor.getRootElement();

    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) =>
          navigate(
            event,
            "prev",
            "end",
            () => $isCollapsed() && isCaretOnEdgeLine(root(), "first"),
          ),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) =>
          navigate(
            event,
            "next",
            "start",
            () => $isCollapsed() && isCaretOnEdgeLine(root(), "last"),
          ),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        (event) =>
          navigate(event, "prev", "end", () => $isCollapsedAtEdge("start")),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) =>
          navigate(event, "next", "start", () => $isCollapsedAtEdge("end")),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!$isCollapsedAtEdge("start")) return false;
          // An emptied moment steps back into the one before it.
          if (!$getRoot().getTextContent().trim()) {
            if (!focusNeighbor(idRef.current, "prev", "end")) return false;
            event.preventDefault();
            return true;
          }
          // Otherwise do nothing: moments never merge by accident.
          event.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  return null;
}

type MomentHandlePluginProps = {
  registryId: string;
  flush: () => Promise<number | null>;
  retry: () => void;
};

/** Registers this editor so neighbours, the writing loop and the outline can reach it. */
export function MomentHandlePlugin({
  flush,
  registryId,
  retry,
}: MomentHandlePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const focusEdge = (edge: "start" | "end") => {
      editor.update(() => {
        const root = $getRoot();
        if (edge === "start") root.selectStart();
        else root.selectEnd();
      });
      editor.focus(undefined, {
        defaultSelection: edge === "start" ? "rootStart" : "rootEnd",
      });
    };
    const handle: MomentEditorHandle = {
      focusStart: () => focusEdge("start"),
      focusEnd: () => focusEdge("end"),
      getMarkdownSplitAtSelection: () =>
        editor.getEditorState().read($splitMarkdownAtSelection),
      flush,
      retry,
    };
    return registerMomentEditor(registryId, handle);
  }, [editor, flush, registryId, retry]);

  return null;
}

type ExternalProsePluginProps = {
  prose: StudioProseDto | undefined;
  adoptExternal: (prose: StudioProseDto) => boolean;
};

/** Loads a newer revision written elsewhere (Keep, split, merge, restore). */
export function ExternalProsePlugin({
  adoptExternal,
  prose,
}: ExternalProsePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!prose || !adoptExternal(prose)) return;
    // Discrete, so history has recorded the load before it is cleared below.
    editor.update(
      () => {
        $convertFromMarkdownString(
          prose.markdown,
          STUDIO_MARKDOWN_TRANSFORMERS,
        );
      },
      { discrete: true, tag: STUDIO_EXTERNAL_PROSE_TAG },
    );
    // Undo past this point would bring back text the server already replaced
    // (the pre-split whole, the pre-Keep draft), and autosave would save it
    // as a duplicate. Versions keep the old text instead.
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [adoptExternal, editor, prose]);

  return null;
}

/** Keeps Lexical's editable flag in step with the `editable` prop. */
export function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);
  return null;
}

type FocusTrackingPluginProps = {
  onFocus: () => void;
  onBlur: () => void;
};

export function FocusTrackingPlugin({
  onBlur,
  onFocus,
}: FocusTrackingPluginProps) {
  const [editor] = useLexicalComposerContext();
  const handlersRef = useRef({ onBlur, onFocus });
  useEffect(() => {
    handlersRef.current = { onBlur, onFocus };
  }, [onBlur, onFocus]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          FOCUS_COMMAND,
          () => {
            handlersRef.current.onFocus();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            handlersRef.current.onBlur();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );

  return null;
}
