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
  summary: string;
  updatedAt: string;
};

export type StoryEditorData = StoryListItem &
  StoryContext & {
    chapters: StoryChapterItem[];
  };
