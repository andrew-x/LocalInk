import type {
  StoryCharacter,
  StoryLocation,
  StoryVoiceExemplar,
} from "@/lib/drizzle/schema";

export type StoryListItem = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
};

export type StoryContext = {
  characters: StoryCharacter[];
  backstory: string;
  locations: StoryLocation[];
  style: string;
  systemInstructions: string;
  voiceExemplars: StoryVoiceExemplar[];
};

export type StoryUpdateResult = StoryListItem & StoryContext;

export type StoryChapterItem = {
  id: string;
  name: string;
  position: number;
  content: string;
  contentRevision: number;
  // Background-generated story state for this chapter. Empty until the first
  // refresh, and briefly stale after an edit; both are expected.
  synopsis: string;
  updatedAt: string;
};

export type StoryEditorData = StoryListItem &
  StoryContext & {
    chapters: StoryChapterItem[];
  };
