import type { InitialConfigType } from "@lexical/react/LexicalComposer";

/** Book type for every manuscript block: editors, drafts and the continue area. */
export const STUDIO_PROSE_CLASS =
  "font-content text-[1.125rem] leading-8 text-foreground/95";

/**
 * Book paragraphs: no gap, first-line indent. Moments stack seamlessly, so
 * the spacing between two moments equals the spacing between paragraphs.
 */
export const STUDIO_PARAGRAPH_CLASS = "m-0 indent-[1.4em]";

/** No indent on the first paragraph after a chapter heading or scene break. */
export const STUDIO_SCENE_START_CLASS = "[&>p:first-child]:indent-0";

/** Text formats copied from the story editor; paragraphs follow book style. */
export const STUDIO_EDITOR_THEME: InitialConfigType["theme"] = {
  paragraph: STUDIO_PARAGRAPH_CLASS,
  text: {
    bold: "font-semibold",
    italic: "italic",
  },
};
