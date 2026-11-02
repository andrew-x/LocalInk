"use client";

import { Plus } from "lucide-react";
import { type ComponentProps, useCallback, useMemo, useState } from "react";

import { createStudioEntry } from "@/actions/studio/create-studio-entry";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { MENU_ITEM_CLASS } from "@/components/studio/outline/scene-menu";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryDto, StudioEntryType } from "@/lib/studio/contracts";

import { EntryCard } from "./entry-card";
import { EntryLine, sceneCountsByEntry } from "./entry-line";
import { DEFAULT_RELATIONSHIP_NAME } from "./relationship-editor";

type OtherKind = {
  type: Exclude<StudioEntryType, "character" | "place">;
  label: string;
};

/** The default name is "New <noun>"; relationships and customs differ. */
const DEFAULT_NOUNS: Partial<Record<StudioEntryType, string>> = {
  character: "character",
  place: "place",
  thing: "thing",
  lore: "lore entry",
};

const OTHER_KINDS: OtherKind[] = [
  { type: "relationship", label: "Relationship" },
  { type: "thing", label: "Thing" },
  { type: "lore", label: "Lore" },
  { type: "custom", label: "Custom…" },
];

function byPosition(a: StudioEntryDto, b: StudioEntryDto): number {
  return (
    a.position - b.position ||
    (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
  );
}

function AddButton({
  label,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Button>, "aria-label">) {
  return (
    <Button
      aria-label={label}
      className="h-6 px-2 font-medium text-caption text-muted-foreground normal-case tracking-normal"
      size="sm"
      {...props}
      type="button"
      variant="ghost"
    >
      <Plus aria-hidden="true" className="size-3" />
      Add
    </Button>
  );
}

/** The Other group's "+ Add": which kind, and a label for Custom. */
function AddOtherMenu({
  onCreate,
}: {
  onCreate: (type: OtherKind["type"], customLabel?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [askingLabel, setAskingLabel] = useState(false);
  const [label, setLabel] = useState("");

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setAskingLabel(false);
      setLabel("");
    }
  }

  function submitCustom() {
    const clean = label.trim();
    if (!clean) return;
    close(false);
    onCreate("custom", clean);
  }

  return (
    <Popover onOpenChange={close} open={open}>
      <PopoverTrigger asChild>
        <AddButton label="Add to Other" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-48 flex-col p-1">
        {askingLabel ? (
          <form
            className="flex flex-col gap-1.5 p-1"
            onSubmit={(event) => {
              event.preventDefault();
              submitCustom();
            }}
          >
            <Input
              aria-label="Custom type label"
              autoFocus
              className="h-8"
              maxLength={60}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Spell, Faction"
              value={label}
            />
            <Button
              disabled={!label.trim()}
              size="sm"
              type="submit"
              variant="outline"
            >
              Add
            </Button>
          </form>
        ) : (
          OTHER_KINDS.map((kind) => (
            <button
              className={MENU_ITEM_CLASS}
              key={kind.type}
              onClick={() => {
                if (kind.type === "custom") setAskingLabel(true);
                else {
                  close(false);
                  onCreate(kind.type);
                }
              }}
              type="button"
            >
              {kind.label}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

type GroupProps = {
  title: string;
  entries: StudioEntryDto[];
  sceneCounts: Map<string, number>;
  openEntryId: string | null;
  focusNameId: string | null;
  onToggle: (entryId: string) => void;
  onDeleted: () => void;
  showKind?: boolean;
  add: React.ReactNode;
};

function Group({
  add,
  entries,
  focusNameId,
  onDeleted,
  onToggle,
  openEntryId,
  sceneCounts,
  showKind,
  title,
}: GroupProps) {
  return (
    <section aria-label={title} className="flex flex-col">
      <div className="flex items-center gap-2 px-2 pt-3 pb-1">
        <h3 className="font-semibold text-[11px] text-muted-foreground/80 uppercase tracking-wider">
          {title}
        </h3>
        <div className="ml-auto">{add}</div>
      </div>
      {entries.length === 0 ? (
        <p className="px-2 py-1 text-label-sm text-muted-foreground/80">
          Nothing here yet.
        </p>
      ) : null}
      {entries.map((entry) =>
        entry.id === openEntryId ? (
          <EntryCard
            entry={entry}
            focusName={focusNameId === entry.id}
            key={entry.id}
            onClose={() => onToggle(entry.id)}
            onDeleted={onDeleted}
          />
        ) : (
          <EntryLine
            entry={entry}
            key={entry.id}
            onOpen={() => onToggle(entry.id)}
            sceneCount={sceneCounts.get(entry.id) ?? 0}
            showKind={showKind}
          />
        ),
      )}
    </section>
  );
}

/**
 * The "Characters & places" tab: one line per entry in Characters, Places,
 * and Other. One card is open at a time, driven by the store's `openEntryId`.
 */
export function CharactersPanel() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const { entries, openEntryId, planItems } = state;
  const storyId = state.story.id;
  // The entry just created from "+ Add", whose name is selected for typing.
  const [focusNameId, setFocusNameId] = useState<string | null>(null);

  const sceneCounts = useMemo(() => sceneCountsByEntry(planItems), [planItems]);
  const groups = useMemo(() => {
    const sorted = [...entries].sort(byPosition);
    return {
      characters: sorted.filter((entry) => entry.type === "character"),
      places: sorted.filter((entry) => entry.type === "place"),
      other: sorted.filter(
        (entry) => entry.type !== "character" && entry.type !== "place",
      ),
    };
  }, [entries]);

  const create = useCallback(
    async (type: StudioEntryType, customLabel?: string) => {
      const noun =
        type === "custom"
          ? (customLabel ?? "entry")
          : (DEFAULT_NOUNS[type] ?? type);
      const name =
        type === "relationship" ? DEFAULT_RELATIONSHIP_NAME : `New ${noun}`;
      const created = await run(
        createStudioEntry({
          storyId,
          type,
          name,
          ...(type === "custom" ? { customTypeLabel: customLabel } : {}),
        }),
        "The entry could not be created.",
      );
      if (!created) return;
      setFocusNameId(created.id);
      dispatch({ type: "merge", entries: [created] });
      dispatch({ type: "openEntry", entryId: created.id });
    },
    [dispatch, run, storyId],
  );

  const toggle = useCallback(
    (entryId: string) =>
      dispatch({
        type: "openEntry",
        entryId: openEntryId === entryId ? null : entryId,
      }),
    [dispatch, openEntryId],
  );
  const closeOpen = useCallback(
    () => dispatch({ type: "openEntry", entryId: null }),
    [dispatch],
  );

  const shared = {
    focusNameId,
    onDeleted: closeOpen,
    onToggle: toggle,
    openEntryId,
    sceneCounts,
  };

  return (
    <div className="flex flex-col px-2 pb-4">
      <Group
        {...shared}
        add={
          <AddButton
            label="Add a character"
            onClick={() => void create("character")}
          />
        }
        entries={groups.characters}
        title="Characters"
      />
      <Group
        {...shared}
        add={
          <AddButton label="Add a place" onClick={() => void create("place")} />
        }
        entries={groups.places}
        title="Places"
      />
      <Group
        {...shared}
        add={
          <AddOtherMenu
            onCreate={(type, customLabel) => void create(type, customLabel)}
          />
        }
        entries={groups.other}
        showKind
        title="Other"
      />
    </div>
  );
}
