/** DOM ids shared between the plan tree, arc strip and manuscript. */
export function studioPlanRowId(itemId: string): string {
  return `studio-plan-row-${itemId}`;
}

/** Task 11's manuscript should put this id on each chapter heading. */
export function studioChapterAnchorId(itemId: string): string {
  return `studio-chapter-${itemId}`;
}

export function scrollToStudioItem(itemId: string, chapterAnchor = false) {
  const row = document.getElementById(studioPlanRowId(itemId));
  row?.scrollIntoView({ block: "nearest" });
  if (chapterAnchor) {
    document
      .getElementById(studioChapterAnchorId(itemId))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
