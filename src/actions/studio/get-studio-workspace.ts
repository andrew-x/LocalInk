"use server";

import { runLoggedAction } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { loadStudioWorkspace } from "@/lib/server/studio/repository";

import { getStudioWorkspaceSchema } from "./_schemas";
import type { StudioWorkspace } from "./_types";

export async function getStudioWorkspace(
  storyId: string,
): Promise<StudioWorkspace | null> {
  return runLoggedAction({ action: "studio-get-workspace" }, async () => {
    const input = getStudioWorkspaceSchema.safeParse({ storyId });
    if (!input.success) {
      throw new ActionError("BAD_REQUEST", "The story id is not valid.");
    }
    return loadStudioWorkspace(input.data.storyId);
  });
}
