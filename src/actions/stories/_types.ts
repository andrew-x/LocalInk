import type { StoryCharacter } from "@/lib/drizzle/schema";

export type StoryListItem = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
};

export type StoryContext = {
  characters: StoryCharacter[];
  style: string;
};

export type StoryUpdateResult = StoryListItem & StoryContext;

export type StoryChapterChunkItem = {
  id: string;
  text: string;
  startPosition: number;
  endPosition: number;
};

export type StoryChapterItem = {
  id: string;
  name: string;
  position: number;
  content: string;
  indexedHash: string;
  indexedAt: string | null;
  summary: string;
  chunks: StoryChapterChunkItem[];
  updatedAt: string;
};

export type StoryChapterIndexSnapshot = Pick<
  StoryChapterItem,
  "chunks" | "id" | "indexedAt" | "indexedHash" | "summary" | "updatedAt"
>;

export type StoryEditorData = StoryListItem &
  StoryContext & {
    chapters: StoryChapterItem[];
  };

export type ChapterIndexTriggerReason =
  | "autosave-debounce"
  | "chapter-switch"
  | "editor-unmount";

export type ChapterIndexStatus =
  | "cleared-empty"
  | "discarded-changed"
  | "indexed"
  | "not-found"
  | "skipped-current";

export type ChapterIndexResult = {
  chapter: StoryChapterIndexSnapshot | null;
  chapterId: string;
  chunkCount: number;
  indexedAt: string | null;
  indexedHash: string | null;
  status: ChapterIndexStatus;
  storyId: string;
};
