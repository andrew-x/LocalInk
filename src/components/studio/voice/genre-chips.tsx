"use client";

import { useRef, useState } from "react";

import { Input } from "@/components/common/input";
import { cleanGenre, STUDIO_VOICE_LIMITS } from "@/lib/studio/voice";

type GenreChipsProps = {
  genre: string[];
  onChange: (genre: string[]) => void;
};

/** Genre labels as chips. Change opens a comma-separated field. */
export function GenreChips({ genre, onChange }: GenreChipsProps) {
  const [editing, setEditing] = useState(false);
  const done = useRef(false);

  function commit(text: string) {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const next = cleanGenre(text.split(","));
    if (next.join("\n") !== genre.join("\n")) onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-bold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]">
        Genre
      </span>
      {editing ? (
        <Input
          aria-label="Genre, separated by commas"
          autoFocus
          className="h-7 min-w-40 flex-1 text-label-sm"
          defaultValue={genre.join(", ")}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              done.current = true;
              setEditing(false);
            }
          }}
          placeholder={`Up to ${STUDIO_VOICE_LIMITS.genreLabels}, like YA, Romance`}
        />
      ) : (
        <>
          {genre.map((label) => (
            <span
              className="rounded-full bg-muted px-2.5 py-px text-caption"
              key={label}
            >
              {label}
            </span>
          ))}
          <button
            className="cursor-pointer rounded-sm text-caption text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => {
              done.current = false;
              setEditing(true);
            }}
            type="button"
          >
            {genre.length > 0 ? "Change" : "Add genre"}
          </button>
        </>
      )}
    </div>
  );
}
