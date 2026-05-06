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

export type StoryChapterItem = {
  id: string;
  name: string;
  position: number;
  content: string;
  indexedHash: string;
  indexedAt: string | null;
  summary: string;
  updatedAt: string;
};

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
  chapterId: string;
  chunkCount: number;
  indexedAt: string | null;
  indexedHash: string | null;
  status: ChapterIndexStatus;
  storyId: string;
};
