"use client";

import { useMemo } from "react";

import {
  chapterNumberOf,
  chapterNumbers,
  entryNameMap,
} from "@/components/studio/shared/inspect-labels";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { normalizeAspect } from "@/lib/studio/aspects";
import type { StudioChangeDto, StudioEntryDto } from "@/lib/studio/contracts";
import { buildPlanTree, getPlanIndex } from "@/lib/studio/plan-order";
import { cn } from "@/lib/util";

import { SectionHeading } from "./section-heading";

type Row = {
  key: string;
  label: string;
  cells: Map<number, StudioChangeDto[]>;
};

/** The entry's changes as one row per aspect and one column per chapter. */
export function OverTheStory({ entry }: { entry: StudioEntryDto }) {
  const { state, dispatch } = useStudioStore();
  const { changes, entries, planItems } = state;

  const names = useMemo(() => entryNameMap(entries), [entries]);
  const numbers = useMemo(() => chapterNumbers(planItems), [planItems]);
  const chapters = useMemo(
    () =>
      buildPlanTree(planItems).map((node) => ({
        id: node.id,
        number: numbers.get(node.id) ?? 0,
        title: node.title.trim(),
      })),
    [numbers, planItems],
  );
  const rows = useMemo(() => {
    const order = getPlanIndex(planItems);
    const byRow = new Map<string, Row>();
    const mine = changes
      .filter((change) => change.entryId === entry.id)
      .sort(
        (a, b) =>
          (order.get(a.planItemId)?.order ?? 0) -
            (order.get(b.planItemId)?.order ?? 0) || a.position - b.position,
      );
    for (const change of mine) {
      const chapter = chapterNumberOf(planItems, numbers, change.planItemId);
      if (chapter === null) continue;
      const key = `${normalizeAspect(change.aspect)}|${change.aboutEntryId ?? ""}`;
      let row = byRow.get(key);
      if (!row) {
        row = { key, label: "", cells: new Map() };
        byRow.set(key, row);
      }
      // Rows read as stored; the latest change's wording names the row.
      const about = change.aboutEntryId
        ? ` (about ${names.get(change.aboutEntryId) ?? "someone"})`
        : "";
      row.label = `${change.aspect.trim()}${about}`;
      const cell = row.cells.get(chapter) ?? [];
      cell.push(change);
      row.cells.set(chapter, cell);
    }
    // Rows keep the order each label was first used.
    return [...byRow.values()];
  }, [changes, entry.id, names, numbers, planItems]);

  function jumpTo(planItemId: string) {
    dispatch({ type: "setPlanTab", tab: "outline" });
    dispatch({ type: "select", itemId: planItemId });
  }

  return (
    <section aria-label="Over the story" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <SectionHeading>Over the story</SectionHeading>
        <span className="text-caption text-muted-foreground">
          <span aria-hidden="true">●</span> confirmed{" "}
          <span aria-hidden="true">○</span> planned
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-label-sm text-muted-foreground">
          Nothing changes for {entry.name || "this entry"} yet. The AI records
          changes as you write.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/70">
          <table className="w-full border-collapse text-left text-label-sm">
            <thead>
              <tr className="border-border/70 border-b bg-card/40">
                <th className="sticky left-0 z-10 w-32 min-w-32 bg-card px-2 py-1.5" />
                {chapters.map((chapter) => (
                  <th
                    className="min-w-40 px-2 py-1.5 align-bottom font-medium text-caption text-muted-foreground"
                    key={chapter.id}
                    title={chapter.title || undefined}
                  >
                    Ch {chapter.number}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className="border-border/50 border-b last:border-b-0"
                  key={row.key}
                >
                  <th
                    className="sticky left-0 z-10 bg-card px-2 py-2 align-top font-medium"
                    scope="row"
                  >
                    {row.label}
                  </th>
                  {chapters.map((chapter) => {
                    const cell = row.cells.get(chapter.number);
                    return (
                      <td className="px-2 py-2 align-top" key={chapter.id}>
                        {cell ? (
                          <ul className="flex flex-col gap-1">
                            {cell.map((change) => (
                              <li key={change.id}>
                                <button
                                  className="flex w-full items-start gap-1.5 rounded-sm text-left outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                                  onClick={() => jumpTo(change.planItemId)}
                                  title="Go to this moment"
                                  type="button"
                                >
                                  <span
                                    aria-label={
                                      change.status === "confirmed"
                                        ? "Confirmed"
                                        : "Planned"
                                    }
                                    className={cn(
                                      "mt-1.5 size-2 shrink-0 rounded-full border border-primary",
                                      change.status === "confirmed" &&
                                        "bg-primary",
                                    )}
                                    role="img"
                                  />
                                  <span className="break-words">
                                    {change.value}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">same</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
