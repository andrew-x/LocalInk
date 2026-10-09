import type { StoryChapterItem } from "@/actions/stories/_types";

/** Synchronous editor locks precede asynchronous save/action work. */
export type ChapterManuscriptController = {
  snapshot: () => {
    id: string;
    content: string;
    contentRevision: number;
    selection: string | null;
  };
  hasDraft: () => boolean;
  isDirty: () => boolean;
  freeze: () => void;
  flush: () => Promise<void>;
  validateImport: (content: string) => void;
  importCommitted: (chapter: StoryChapterItem) => void;
  release: () => void;
};

export const MANUSCRIPT_COMMIT_TAG = "manuscript-commit";

/** Only these messages may be displayed by the chat operation error UI. */
export class ManuscriptResolutionError extends Error {}
