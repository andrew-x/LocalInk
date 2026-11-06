import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { studioEntries } from "@/lib/drizzle/schema";
import {
  STUDIO_CAST_TYPES,
  type StagedStudioCast,
  type StagedStudioCastRevision,
  type StudioCastApplyResult,
  type StudioCastMode,
  type StudioCastRevisionApplyResult,
} from "@/lib/studio/cast-contract";
import type { StudioEntryDto } from "@/lib/studio/contracts";

import { requireStudioStory } from "./repository";
import {
  applyRefreshedEntryFields,
  insertStudioEntry,
} from "./repository-bible";
import {
  dropStudioStage,
  getStudioStage,
  type StudioStageBinding,
} from "./staging";

/**
 * Saves a staged cast as character and place entries. Cast drafts happen
 * before the plan, so a planned story refuses them. A name already in the
 * story with the same type (from an earlier draft or add) is skipped in a
 * draft and refused for an explicit add.
 */
export function commitStudioCast(input: {
  storyId: string;
  generationId: string;
  mode: StudioCastMode;
}): StudioCastApplyResult {
  const binding: StudioStageBinding = {
    storyId: input.storyId,
    kind: "cast",
    targetId: input.mode,
    generationId: input.generationId,
  };
  const staged = getStudioStage<StagedStudioCast>(binding);
  if (staged.mode !== input.mode) {
    throw new ActionError(
      "BAD_REQUEST",
      "This generated result does not match the request. Please generate it again.",
    );
  }

  const result = getDb().transaction((tx) => {
    const story = requireStudioStory(tx, input.storyId);
    if (story.setupStatus !== "draft") {
      throw new ActionError(
        "BAD_REQUEST",
        "This story is already planned. Add people and places from the Characters & places tab.",
      );
    }
    const taken = new Set(
      tx
        .select({ type: studioEntries.type, name: studioEntries.name })
        .from(studioEntries)
        .where(
          and(
            eq(studioEntries.storyId, input.storyId),
            inArray(studioEntries.type, [...STUDIO_CAST_TYPES]),
          ),
        )
        .all()
        .map((row) => `${row.type}:${row.name.trim().toLowerCase()}`),
    );
    const entries: StudioEntryDto[] = [];
    const picks: StudioCastApplyResult["picks"] = {};
    for (const member of staged.members) {
      const key = `${member.type}:${member.name.trim().toLowerCase()}`;
      if (taken.has(key)) {
        if (input.mode === "add") {
          throw new ActionError(
            "BAD_REQUEST",
            `${member.name} is already in the story.`,
          );
        }
        continue;
      }
      taken.add(key);
      const entry = insertStudioEntry(tx, {
        storyId: input.storyId,
        type: member.type,
        name: member.name,
        summary: member.summary,
        fields: member.fields,
        fieldAuthor: "ai",
        // Even when empty, so a pick or nudge can still write it.
        summaryOrigin: "ai",
      });
      entries.push(entry);
      picks[entry.id] = member.picks;
    }
    return { entries, picks };
  });
  // Dropped only after a successful commit so a failed apply can be retried.
  dropStudioStage(binding);
  return result;
}

export function commitStudioCastRevision(input: {
  storyId: string;
  entryId: string;
  generationId: string;
}): StudioCastRevisionApplyResult {
  const binding: StudioStageBinding = {
    storyId: input.storyId,
    kind: "cast",
    targetId: `revise:${input.entryId}`,
    generationId: input.generationId,
  };
  const staged = getStudioStage<StagedStudioCastRevision>(binding);
  const entry = getDb().transaction((tx) =>
    applyRefreshedEntryFields(tx, {
      storyId: input.storyId,
      entryId: input.entryId,
      sourceRevision: staged.sourceRevision,
      ops: staged.ops,
      summary: staged.summary,
    }),
  );
  dropStudioStage(binding);
  return { entry, stale: entry === null };
}
