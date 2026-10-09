import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { createEditor } from "lexical";

import { CHAPTER_MARKDOWN_TRANSFORMERS } from "@/components/story-editor/chapter-markdown";

/** Use the same roundtrip as the manuscript editor before committing an external edit. */
export function canonicalizeManuscriptMarkdown(markdown: string): string {
  const editor = createEditor({
    namespace: "LocalInkManuscriptValidation",
    onError(error) {
      throw error;
    },
  });

  editor.update(
    () => {
      $convertFromMarkdownString(
        markdown,
        CHAPTER_MARKDOWN_TRANSFORMERS,
        undefined,
        true,
      );
    },
    { discrete: true },
  );

  return editor
    .getEditorState()
    .read(() =>
      $convertToMarkdownString(CHAPTER_MARKDOWN_TRANSFORMERS, undefined, true),
    );
}
