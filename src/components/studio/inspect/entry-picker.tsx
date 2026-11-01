"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { STUDIO_ENTRY_TEMPLATES } from "@/lib/studio/bible-templates";
import type { StudioEntryDto } from "@/lib/studio/contracts";

type EntryPickerProps = {
  entries: StudioEntryDto[];
  label: string;
  onPick: (entryId: string) => void;
};

/** A "+ add" button that opens a filterable list of Bible entries. */
export function EntryPicker({ entries, label, onPick }: EntryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = entries.filter((entry) =>
    entry.name.toLowerCase().includes(needle),
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          className="h-6 gap-1 px-2 text-caption text-muted-foreground"
          disabled={entries.length === 0}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <Input
          aria-label="Filter entries"
          autoFocus
          className="h-8"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches[0]) {
              event.preventDefault();
              onPick(matches[0].id);
              handleOpenChange(false);
            }
          }}
          placeholder="Find an entry"
          value={query}
        />
        <ul className="mt-1 flex max-h-56 flex-col overflow-y-auto">
          {matches.length === 0 ? (
            <li className="px-2 py-1.5 text-caption text-muted-foreground">
              No matching entries.
            </li>
          ) : (
            matches.map((entry) => (
              <li key={entry.id}>
                <button
                  className="flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-label-sm outline-none hover:bg-muted focus-visible:bg-muted"
                  onClick={() => {
                    onPick(entry.id);
                    handleOpenChange(false);
                  }}
                  type="button"
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 text-caption text-muted-foreground">
                    {entry.type === "custom" && entry.customTypeLabel
                      ? entry.customTypeLabel
                      : STUDIO_ENTRY_TEMPLATES[entry.type].label}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
