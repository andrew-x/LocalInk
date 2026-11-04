import { Fragment, type ReactNode } from "react";

const INLINE_EMPHASIS =
  /(\*\*\*[^*\n]+\*\*\*|___[^_\n]+___|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)/g;

/** Renders the studio emphasis subset; anything unclosed stays literal while it streams. */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  let isEmphasis = false;
  // A capturing split alternates plain text and emphasis matches.
  for (const part of text.split(INLINE_EMPHASIS)) {
    const key = `${isEmphasis ? "e" : "t"}${offset}`;
    offset += part.length;
    if (!isEmphasis) {
      nodes.push(<Fragment key={key}>{part}</Fragment>);
    } else if (/^(\*\*\*|___)/.test(part)) {
      nodes.push(
        <strong className="font-semibold italic" key={key}>
          {part.slice(3, -3)}
        </strong>,
      );
    } else if (/^(\*\*|__)/.test(part)) {
      nodes.push(
        <strong className="font-semibold" key={key}>
          {part.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(<em key={key}>{part.slice(1, -1)}</em>);
    }
    isEmphasis = !isEmphasis;
  }
  return nodes;
}

/** Non-empty paragraphs, keyed by offset so keys stay stable while text streams. */
export function draftParagraphs(text: string): { key: string; text: string }[] {
  let offset = 0;
  return text
    .split(/\n+/)
    .map((paragraph) => {
      const key = `p${offset}`;
      offset += paragraph.length + 1;
      return { key, text: paragraph.trim() };
    })
    .filter((paragraph) => paragraph.text.length > 0);
}
