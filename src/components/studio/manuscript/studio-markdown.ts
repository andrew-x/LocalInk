import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  type Transformer,
} from "@lexical/markdown";

/**
 * Emphasis only, copied from the story editor on purpose (Studio stays
 * separate from story-editor modules). Studio prose separates paragraphs with
 * a blank line, so editors convert with `shouldPreserveNewLines` off.
 */
export const STUDIO_MARKDOWN_TRANSFORMERS: Array<Transformer> = [
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
];
