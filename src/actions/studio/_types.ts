import type { StudioSetupStatus } from "@/lib/studio/contracts";

export type {
  StudioChangeDto,
  StudioEntryDto,
  StudioFlagDto,
  StudioPlanItemDto,
  StudioProseDto,
  StudioStoryDto,
  StudioWorkspace,
} from "@/lib/studio/contracts";

export type StudioStoryListItem = {
  id: string;
  title: string;
  overview: string;
  setupStatus: StudioSetupStatus;
  updatedAt: string;
};

export type StudioProseVersionListItem = {
  id: string;
  origin: "ai" | "author" | "ai-edited";
  wordCount: number;
  createdAt: string;
};

export type {
  StudioFlagResolveResult,
  StudioReadBackApplyResult,
} from "@/lib/server/studio/read-back-apply";
