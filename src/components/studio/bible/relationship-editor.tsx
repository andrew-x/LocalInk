"use client";

import { Label } from "@/components/common/label";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryDto } from "@/lib/studio/contracts";

import { BibleHeading } from "./bible-field";
import { usePatchEntry } from "./use-patch-entry";

export const DEFAULT_RELATIONSHIP_NAME = "New relationship";

const SELECT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card/80 px-2 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35";

/** The two people a relationship is between, in the order they were picked. */
export function relationshipPair(
  entry: StudioEntryDto,
  entries: StudioEntryDto[],
): [StudioEntryDto | undefined, StudioEntryDto | undefined] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return [
    byId.get(entry.relatedEntryIds[0] ?? ""),
    byId.get(entry.relatedEntryIds[1] ?? ""),
  ];
}

/** Picks the two characters a relationship is between. No chart. */
export function RelationshipEditor({ entry }: { entry: StudioEntryDto }) {
  const { state } = useStudioStore();
  const patchEntry = usePatchEntry();
  const characters = state.entries.filter((e) => e.type === "character");
  const [first, second] = relationshipPair(entry, state.entries);

  function pick(slot: 0 | 1, id: string) {
    const picked: (StudioEntryDto | undefined)[] = [first, second];
    picked[slot] = characters.find((c) => c.id === id);
    // Keep the pair contiguous so "first" and "second" stay meaningful.
    const people = picked.filter(
      (person): person is StudioEntryDto => person !== undefined,
    );
    void patchEntry(entry.id, (latest) => ({
      relatedEntryIds: people.map((person) => person.id),
      ...(people.length === 2 && latest.name === DEFAULT_RELATIONSHIP_NAME
        ? { name: `${people[0].name} & ${people[1].name}` }
        : {}),
    }));
  }

  const idBase = `bible-rel-${entry.id}`;
  return (
    <section aria-label="Between" className="flex flex-col gap-3">
      <BibleHeading>Between</BibleHeading>
      <div className="grid grid-cols-2 gap-3">
        {([0, 1] as const).map((slot) => {
          const current = slot === 0 ? first : second;
          const other = slot === 0 ? second : first;
          return (
            <div className="flex flex-col gap-1" key={slot}>
              <Label
                className="font-medium text-label-sm"
                htmlFor={`${idBase}-${slot}`}
              >
                {slot === 0 ? "First person" : "Second person"}
              </Label>
              <select
                className={SELECT_CLASS}
                disabled={slot === 1 && !first}
                id={`${idBase}-${slot}`}
                onChange={(event) => pick(slot, event.target.value)}
                value={current?.id ?? ""}
              >
                <option value="">Choose a character…</option>
                {characters
                  .filter((c) => c.id !== other?.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
      </div>
      {characters.length < 2 ? (
        <p className="text-caption text-muted-foreground">
          Add two characters to pick who this is between.
        </p>
      ) : null}
    </section>
  );
}
