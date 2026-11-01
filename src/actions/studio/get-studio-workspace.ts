"use server";

import { runLoggedAction } from "@/lib/action";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";

import { getStudioWorkspaceSchema } from "./_schemas";
import type { StudioWorkspace } from "./_types";

export async function getStudioWorkspace(
  storyId: string,
): Promise<StudioWorkspace | null> {
  return runLoggedAction({ action: "studio-get-workspace" }, async () => {
    const input = getStudioWorkspaceSchema.parse({ storyId });
    return loadStudioWorkspace(input.storyId);
  });
}
