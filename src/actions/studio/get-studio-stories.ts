"use server";

import { runLoggedAction } from "@/lib/action";
import { listStudioStories } from "@/lib/server/studio/repository";

import type { StudioStoryListItem } from "./_types";

export async function getStudioStories(): Promise<StudioStoryListItem[]> {
  return runLoggedAction({ action: "studio-get-stories" }, async () =>
    listStudioStories(),
  );
}
