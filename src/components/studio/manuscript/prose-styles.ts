import type { InitialConfigType } from "@lexical/react/LexicalComposer";

/**
 * Book type for every manuscript block: editors and drafts. 19px Literata on
 * the manuscript column's measure gives about 65-70 characters a line;
 * `text-pretty` avoids one-word last lines.
 */
export const STUDIO_PROSE_CLASS =
  "font-content text-[1.1875rem] leading-[1.75] text-foreground/95 text-pretty";

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
