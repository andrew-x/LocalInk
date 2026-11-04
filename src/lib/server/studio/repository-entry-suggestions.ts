import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import type { LocalinkTx } from "@/lib/drizzle/db";
import { studioEntries, studioEntrySuggestions } from "@/lib/drizzle/schema";
import type {
  StudioEntryDto,
  StudioEntrySuggestionDto,
} from "@/lib/studio/contracts";
import { studioNameKey } from "@/lib/studio/read-back-contract";
import { toEntryDto, toEntrySuggestionDto } from "./repository";
import { insertStudioEntry } from "./repository-bible";

type Executor = Pick<LocalinkTx, "select">;

export type StudioEntrySuggestionResolveResult = {
  suggestion: StudioEntrySuggestionDto;
  /** The added entry: the new one, or one the author made with that name since. */
  entry: StudioEntryDto | null;
  /** False when Add found an entry with that name and created nothing. */
  entryCreated: boolean;
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

/** An entry of the story whose name matches `nameKey`, if any. */
function findEntryByNameKey(
  tx: LocalinkTx,
  storyId: string,
  nameKey: string,
): StudioEntryDto | null {
  const row = tx
    .select()
    .from(studioEntries)
    .where(eq(studioEntries.storyId, storyId))
    .all()
    .find((entry) => studioNameKey(entry.name) === nameKey);
  return row ? toEntryDto(row) : null;
}

/**
 * Add creates the entry (summary is the suggestion's description) and marks
 * the suggestion added; ignore just marks it ignored. If an entry with the
 * same name exists by now, Add marks the suggestion added and returns that
 * entry instead of creating a duplicate. A suggestion that is already
 * settled stays as it is, so a double click adds nothing twice.
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
    return {
      suggestion: toEntrySuggestionDto(row),
      entry: null,
      entryCreated: false,
    };
  }
  const existing =
    input.decision === "add"
      ? findEntryByNameKey(tx, input.storyId, row.nameKey)
      : null;
  const entry =
    input.decision === "add" && !existing
      ? insertStudioEntry(tx, {
          storyId: input.storyId,
          type: row.type,
          name: row.name,
          summary: row.description,
        })
      : existing;
  const updated = tx
    .update(studioEntrySuggestions)
    .set({
      status: input.decision === "add" ? "added" : "ignored",
      updatedAt: day().toISOString(),
    })
    .where(eq(studioEntrySuggestions.id, row.id))
    .returning()
    .get();
  return {
    suggestion: toEntrySuggestionDto(updated),
    entry,
    entryCreated: existing === null && entry !== null,
  };
}
