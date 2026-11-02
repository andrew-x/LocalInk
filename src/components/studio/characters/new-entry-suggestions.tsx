"use client";

import { useCallback, useMemo, useState } from "react";

import { resolveStudioEntrySuggestion } from "@/actions/studio/resolve-studio-entry-suggestion";
import { Button } from "@/components/common/button";
import {
  chapterNumberOf,
  chapterNumbers,
} from "@/components/studio/shared/inspect-labels";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioEntrySuggestionDto } from "@/lib/studio/contracts";

import { useAutoDetails } from "./use-auto-details";

const ACTION_CLASS =
  "h-6 px-1.5 font-medium text-caption normal-case tracking-normal";

function SuggestionLine({
  chapter,
  suggestion,
}: {
  chapter: number;
  suggestion: StudioEntrySuggestionDto;
}) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const refreshDetails = useAutoDetails();
  const [busy, setBusy] = useState(false);
  const storyId = state.story.id;

  const resolve = useCallback(
    async (decision: "add" | "ignore") => {
      setBusy(true);
      const result = await run(
        resolveStudioEntrySuggestion({
          storyId,
          suggestionId: suggestion.id,
          decision,
        }),
        decision === "add"
          ? "The entry could not be added."
          : "The suggestion could not be ignored.",
      );
      setBusy(false);
      if (!result) return;
      dispatch({
        type: "merge",
        entrySuggestions: [result.suggestion],
        entries: result.entry ? [result.entry] : [],
      });
      if (!result.entry) return;
      dispatch({ type: "openEntry", entryId: result.entry.id });
      // The description is the new entry's paragraph; the AI fills the rest.
      if (result.entry.summary.trim()) refreshDetails(result.entry.id);
    },
    [dispatch, refreshDetails, run, storyId, suggestion.id],
  );

  return (
    <div className="my-0.5 flex min-h-7 min-w-0 items-center gap-2 rounded-md border border-studio-proposed/45 bg-studio-proposed/8 px-2 py-0.5 font-normal text-label-sm">
      <p className="min-w-0 flex-1 truncate">
        <span className="text-studio-proposed">New in Chapter {chapter}: </span>
        <span className="font-semibold">{suggestion.name}</span>
        {suggestion.description ? (
          <span className="text-muted-foreground/80">
            , {suggestion.description}
          </span>
        ) : null}
      </p>
      <Button
        aria-label={`Add ${suggestion.name} to the Bible`}
        className={`${ACTION_CLASS} text-studio-proposed`}
        disabled={busy}
        onClick={() => void resolve("add")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Add
      </Button>
      <Button
        aria-label={`Ignore ${suggestion.name}`}
        className={`${ACTION_CLASS} text-muted-foreground`}
        disabled={busy}
        onClick={() => void resolve("ignore")}
        size="sm"
        type="button"
        variant="ghost"
      >
        Ignore
      </Button>
    </div>
  );
}

/**
 * New people and places the prose introduced that have no entry yet, as violet
 * lines at the top of the Characters & places tab. Ignored names stay ignored
 * for good (the server keeps the suggestion row).
 */
export function NewEntrySuggestions() {
  const { state } = useStudioStore();
  const { entrySuggestions, planItems } = state;
  const numbers = useMemo(() => chapterNumbers(planItems), [planItems]);
  if (entrySuggestions.length === 0) return null;
  return (
    <div className="flex flex-col pt-2">
      {entrySuggestions.map((suggestion) => {
        const chapter = chapterNumberOf(
          planItems,
          numbers,
          suggestion.momentId,
        );
        return chapter === null ? null : (
          <SuggestionLine
            chapter={chapter}
            key={suggestion.id}
            suggestion={suggestion}
          />
        );
      })}
    </div>
  );
}
