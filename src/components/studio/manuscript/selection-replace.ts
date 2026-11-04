import { $generateNodesFromMarkdownString } from "@lexical/markdown";
import {
  $getNodeByKey,
  $isParagraphNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";

import type { CapturedSelection } from "./selection-toolbar-panels";
import { STUDIO_MARKDOWN_TRANSFORMERS } from "./studio-markdown";

/**
 * Replaces the captured selection with markdown. Returns false (and changes
 * nothing) when the selected text is no longer what was captured.
 */
export function replaceCapturedSelection(
  editor: LexicalEditor,
  captured: CapturedSelection,
  markdown: string,
): boolean {
  let replaced = false;
  editor.update(
    () => {
      try {
        const selection = captured.selection.clone();
        if (
          !$getNodeByKey(selection.anchor.key) ||
          !$getNodeByKey(selection.focus.key) ||
          selection.getTextContent() !== captured.plain
        ) {
          return;
        }
        $setSelection(selection);
        const nodes = $generateNodesFromMarkdownString(
          markdown,
          STUDIO_MARKDOWN_TRANSFORMERS,
        );
        const [first] = nodes;
        if (nodes.length === 1 && $isParagraphNode(first)) {
          selection.insertNodes(first.getChildren());
        } else {
          selection.insertNodes(nodes);
        }
        replaced = true;
      } catch {
        replaced = false;
      }
    },
    { discrete: true },
  );
  return replaced;
}
