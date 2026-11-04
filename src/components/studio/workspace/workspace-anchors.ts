/** DOM ids shared between the outline, the manuscript and the top bar. */

/** The outline line for a chapter or scene (an open scene's card header). */
export function studioOutlineLineId(itemId: string): string {
  return `studio-outline-${itemId}`;
}

/** Task 7's manuscript puts this id on each chapter heading. */
export function studioChapterAnchorId(itemId: string): string {
  return `studio-chapter-${itemId}`;
}

/** Task 7's manuscript puts this id on each scene's first block. */
export function studioSceneAnchorId(sceneId: string): string {
  return `studio-scene-${sceneId}`;
}

/**
 * Scrolls the item's outline line into view, and with `manuscript` also its
 * manuscript anchor (chapter heading or scene start). A no-op for anything
 * that is not rendered.
 */
export function scrollToStudioItem(
  itemId: string,
  opts?: { manuscript?: boolean },
) {
  document
    .getElementById(studioOutlineLineId(itemId))
    ?.scrollIntoView({ block: "nearest" });
  if (opts?.manuscript) {
    const anchor =
      document.getElementById(studioChapterAnchorId(itemId)) ??
      document.getElementById(studioSceneAnchorId(itemId));
    anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
