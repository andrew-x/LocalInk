"use client";

import { useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import type { StudioEntryDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import {
  BIBLE_STORY_SECTIONS,
  BIBLE_WORLD_TYPES,
  type BibleCustomGroup,
  entriesInSection,
} from "./bible-sections";

type BibleSidebarProps = {
  activeEntryId: string | null;
  activeSection: string;
  customGroups: BibleCustomGroup[];
  entries: StudioEntryDto[];
  onAdd: (section: string) => void;
  onAddCustomType: (label: string) => void;
  onSelect: (section: string, entryId?: string) => void;
};

const ROW_CLASS =
  "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-label-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40";

export function BibleSidebar({
  activeEntryId,
  activeSection,
  customGroups,
  entries,
  onAdd,
  onAddCustomType,
  onSelect,
}: BibleSidebarProps) {
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");

  function commitCustomType() {
    const next = label.trim();
    if (next) onAddCustomType(next);
    setLabel("");
    setNaming(false);
  }

  const worldGroups = [
    ...BIBLE_WORLD_TYPES.map((type) => ({ id: type.id, label: type.label })),
    ...customGroups,
  ];

  return (
    <nav
      aria-label="Story Bible"
      className="flex min-h-0 flex-col gap-4 overflow-y-auto border-border/80 border-r bg-card/30 p-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="px-2 pb-1 font-semibold text-caption text-muted-foreground uppercase tracking-wide">
          Story
        </h2>
        {BIBLE_STORY_SECTIONS.map((section) => (
          <button
            aria-current={activeSection === section.id ? "page" : undefined}
            className={cn(
              ROW_CLASS,
              "flex-none",
              activeSection === section.id && "bg-muted font-medium",
            )}
            key={section.id}
            onClick={() => onSelect(section.id)}
            type="button"
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-0.5">
        <h2 className="px-2 pb-1 font-semibold text-caption text-muted-foreground uppercase tracking-wide">
          World
        </h2>
        {worldGroups.map((group) => {
          const list = entriesInSection(entries, group.id);
          const active = activeSection === group.id;
          return (
            <div className="flex flex-col" key={group.id}>
              <div className="flex items-center gap-0.5">
                <button
                  aria-current={active && !activeEntryId ? "page" : undefined}
                  className={cn(ROW_CLASS, active && "bg-muted font-medium")}
                  onClick={() => onSelect(group.id)}
                  type="button"
                >
                  <span className="truncate">{group.label}</span>
                  <span className="text-caption text-muted-foreground">
                    {list.length}
                  </span>
                </button>
                <Button
                  aria-label={`Add to ${group.label}`}
                  className="h-6 shrink-0 px-1.5 text-caption text-muted-foreground"
                  onClick={() => onAdd(group.id)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  + add
                </Button>
              </div>
              {active && list.length > 0 ? (
                <ul className="mt-0.5 mb-1 ml-3 flex flex-col gap-0.5 border-border/70 border-l pl-1.5">
                  {list.map((entry) => (
                    <li key={entry.id}>
                      <button
                        aria-current={
                          entry.id === activeEntryId ? "page" : undefined
                        }
                        className={cn(
                          ROW_CLASS,
                          "w-full",
                          entry.id === activeEntryId &&
                            "bg-primary/10 text-primary",
                        )}
                        onClick={() => onSelect(group.id, entry.id)}
                        type="button"
                      >
                        <span className="truncate">
                          {entry.name || "Untitled"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}

        {naming ? (
          <Input
            aria-label="Custom type name"
            autoFocus
            className="mt-1 h-8"
            maxLength={60}
            onBlur={commitCustomType}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitCustomType();
              if (event.key === "Escape") {
                event.stopPropagation();
                setLabel("");
                setNaming(false);
              }
            }}
            placeholder="Type name, such as Factions"
            value={label}
          />
        ) : (
          <Button
            className="mt-1 h-7 self-start px-2 text-caption text-muted-foreground"
            onClick={() => setNaming(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            + custom type
          </Button>
        )}
      </div>
    </nav>
  );
}
