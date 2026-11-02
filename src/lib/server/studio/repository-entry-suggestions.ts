import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioEntrySuggestions } from "@/lib/drizzle/schema";
import type {
  StudioEntryDto,
  StudioEntrySuggestionDto,
} from "@/lib/studio/contracts";
import { toEntrySuggestionDto } from "./repository";
import { insertStudioEntry } from "./repository-bible";

type Executor = Pick<LocalinkTx, "select">;

export type StudioEntrySuggestionResolveResult = {
  suggestion: StudioEntrySuggestionDto;
  entry: StudioEntryDto | null;
};

/** Every suggestion's name and key, of any status, so none is raised twice. */
export function listEntrySuggestionKeys(
  db: Executor,
  storyId: string,
): { name: string; nameKey: string }[] {
  return db
    .select({
      name: studioEntrySuggestions.name,
      nameKey: studioEntrySuggestions.nameKey,
    })
    .from(studioEntrySuggestions)
    .where(eq(studioEntrySuggestions.storyId, storyId))
    .all();
}

/**
 * Add creates the entry (summary is the suggestion's description) and marks
 * the suggestion added; ignore just marks it ignored. A suggestion that is
 * already settled stays as it is, so a double click adds nothing twice.
 */
export function resolveStudioEntrySuggestionInTx(
  tx: LocalinkTx,
  input: {
    storyId: string;
    suggestionId: string;
    decision: "add" | "ignore";
  },
): StudioEntrySuggestionResolveResult {
  const row = tx
    .select()
    .from(studioEntrySuggestions)
    .where(
      and(
        eq(studioEntrySuggestions.id, input.suggestionId),
        eq(studioEntrySuggestions.storyId, input.storyId),
      ),
    )
    .get();
  if (!row) {
    throw new ActionError("BAD_REQUEST", "The suggestion could not be found.");
  }
  if (row.status !== "open") {
    return { suggestion: toEntrySuggestionDto(row), entry: null };
  }
  const entry =
    input.decision === "add"
      ? insertStudioEntry(tx, {
          storyId: input.storyId,
          type: row.type,
          name: row.name,
          summary: row.description,
        })
      : null;
  const updated = tx
    .update(studioEntrySuggestions)
    .set({
      status: input.decision === "add" ? "added" : "ignored",
      updatedAt: day().toISOString(),
    })
    .where(eq(studioEntrySuggestions.id, row.id))
    .returning()
    .get();
  return { suggestion: toEntrySuggestionDto(updated), entry };
}
