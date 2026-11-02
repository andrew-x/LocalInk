"use server";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { requirePlanItem } from "@/lib/server/studio/repository";
import { keepMomentDraft } from "@/lib/server/studio/repository-prose";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "@/lib/server/studio/staging";

import { keepStudioSceneDraftActionSchema } from "./_schemas";
import type { StudioProseDto } from "./_types";

// Usually a restart dropped every staged beat, so point at the one-click redraw.
const EXPIRED_MESSAGE =
  "Part of this draft is no longer available. Use Try again to redraw the scene.";

/**
 * Keeps every drafted beat of a scene, or none. All staged drafts are read
 * before anything is written, and the writes share one transaction, so a
 * missing draft or a stale revision on any beat leaves the whole scene unchanged.
 */
export const keepStudioSceneDraft = publicActionClient
  .metadata({ action: "studio-keep-scene-draft" })
  .inputSchema(keepStudioSceneDraftActionSchema)
  .action(async ({ parsedInput }): Promise<StudioProseDto[]> => {
    const { storyId, sceneId, beats } = parsedInput;
    if (new Set(beats.map((beat) => beat.momentId)).size !== beats.length) {
      throw new ActionError("BAD_REQUEST", "The scene draft is invalid.");
    }

    const staged = beats.map((beat) => {
      const binding: StudioStageBinding = {
        storyId,
        kind: "moment-prose",
        targetId: beat.momentId,
        generationId: beat.generationId,
      };
      let markdown: string;
      try {
        ({ markdown } = getStudioStage<{ markdown: string }>(binding));
      } catch {
        throw new ActionError("BAD_REQUEST", EXPIRED_MESSAGE);
      }
      if (!markdown.trim()) {
        throw new ActionError(
          "BAD_REQUEST",
          "A generated draft is empty. Redo it, then keep the scene.",
        );
      }
      return { beat, binding, markdown };
    });

    const prose = getDb().transaction((tx) => {
      requirePlanItem(tx, storyId, sceneId, "scene");
      for (const { beat } of staged) {
        const item = requirePlanItem(tx, storyId, beat.momentId, "moment");
        if (item.parentId !== sceneId) {
          throw new ActionError("BAD_REQUEST", "The scene draft is invalid.");
        }
      }
      // Any thrown error (including a CAS CONFLICT) rolls back every beat.
      return staged.map(({ beat, markdown }) =>
        keepMomentDraft(tx, {
          storyId,
          momentId: beat.momentId,
          markdown,
          expectedRevision: beat.expectedRevision,
        }),
      );
    });
    // Dropped only after a successful commit so a failed Keep can be retried.
    for (const { binding } of staged) dropStudioStage(binding);
    return prose;
  });
