"use client";

import { useCallback, useMemo, useRef } from "react";

import { createStudioEntry } from "@/actions/studio/create-studio-entry";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/common/dialog";
import { InstructionsStyleSection } from "@/components/studio/settings/instructions-style-section";
import { StructureSection } from "@/components/studio/settings/structure-section";
import {
  type StudioBibleTarget,
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioEntryType } from "@/lib/studio/contracts";

import {
  BIBLE_INSTRUCTIONS_SECTION,
  BIBLE_OVERVIEW_SECTION,
  BIBLE_STRUCTURE_SECTION,
  BIBLE_WORLD_TYPES,
  customSectionId,
  customGroups as deriveCustomGroups,
  entriesInSection,
  isCustomSection,
} from "./bible-sections";
import { BibleSidebar } from "./bible-sidebar";
import { EntryEditor } from "./entry-editor";
import { PremiseSection } from "./premise-section";
import { DEFAULT_RELATIONSHIP_NAME } from "./relationship-editor";

function BibleBody({ target }: { target: StudioBibleTarget }) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const { entries } = state;
  const createdIdRef = useRef<string | null>(null);

  const groups = useMemo(() => deriveCustomGroups(entries), [entries]);
  // A custom type exists only while it has entries; once its last entry is
  // deleted there is nothing to show or add to, so fall back to Overview.
  const section =
    isCustomSection(target.section) &&
    !groups.some((group) => group.id === target.section)
      ? BIBLE_OVERVIEW_SECTION
      : target.section;
  const sectionEntries = useMemo(
    () => entriesInSection(entries, section),
    [entries, section],
  );
  const activeEntry =
    sectionEntries.find((entry) => entry.id === target.entryId) ??
    sectionEntries[0] ??
    null;

  const select = useCallback(
    (next: string, entryId?: string) =>
      dispatch({ type: "openBible", section: next, entryId }),
    [dispatch],
  );

  const create = useCallback(
    async (type: StudioEntryType, label?: string, singular?: string) => {
      const name =
        type === "relationship"
          ? DEFAULT_RELATIONSHIP_NAME
          : `New ${label ?? singular ?? "entry"}`;
      const created = await run(
        createStudioEntry({
          storyId: state.story.id,
          type,
          name,
          ...(type === "custom" ? { customTypeLabel: label } : {}),
        }),
        "The entry could not be created.",
      );
      if (!created) return;
      createdIdRef.current = created.id;
      dispatch({ type: "merge", entries: [created] });
      dispatch({
        type: "openBible",
        section: type === "custom" ? customSectionId(label ?? "") : type,
        entryId: created.id,
      });
    },
    [dispatch, run, state.story.id],
  );

  const add = useCallback(
    (id: string) => {
      const builtIn = BIBLE_WORLD_TYPES.find((type) => type.id === id);
      if (builtIn) return void create(builtIn.id, undefined, builtIn.singular);
      const group = groups.find((item) => item.id === id);
      if (group) void create("custom", group.label);
    },
    [create, groups],
  );

  const singular =
    BIBLE_WORLD_TYPES.find((type) => type.id === section)?.singular ?? "entry";

  let content: React.ReactNode;
  if (section === BIBLE_OVERVIEW_SECTION) content = <PremiseSection />;
  else if (section === BIBLE_INSTRUCTIONS_SECTION)
    content = <InstructionsStyleSection />;
  else if (section === BIBLE_STRUCTURE_SECTION) content = <StructureSection />;
  else if (activeEntry) {
    content = (
      <EntryEditor
        entry={activeEntry}
        focusName={createdIdRef.current === activeEntry.id}
        key={activeEntry.id}
        onDeleted={() => select(section)}
      />
    );
  } else {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-muted-foreground">Nothing here yet.</p>
        <Button onClick={() => add(section)} size="sm" type="button">
          + add {singular}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[16rem_minmax(0,1fr)]">
      <BibleSidebar
        activeEntryId={activeEntry?.id ?? null}
        activeSection={section}
        customGroups={groups}
        entries={entries}
        onAdd={add}
        onAddCustomType={(label) => void create("custom", label)}
        onSelect={select}
      />
      <main className="min-h-0 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-3xl">{content}</div>
      </main>
    </div>
  );
}

/**
 * The full-height Story Bible sheet. The store's `bibleOpen` target decides
 * whether it shows and which section or entry it lands on.
 */
export function BibleSheet() {
  const { state, dispatch } = useStudioStore();
  const target = state.bibleOpen;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) dispatch({ type: "closeBible" });
      }}
      open={target !== null}
    >
      <DialogContent className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100">
        <div className="flex min-h-12 shrink-0 items-center border-border/80 border-b px-4">
          <DialogTitle className="font-serif text-heading">
            Story Bible
          </DialogTitle>
          <DialogDescription className="sr-only">
            Your story&apos;s fixed foundation, characters and world, and how
            they change over the story.
          </DialogDescription>
        </div>
        {target ? <BibleBody target={target} /> : null}
      </DialogContent>
    </Dialog>
  );
}
