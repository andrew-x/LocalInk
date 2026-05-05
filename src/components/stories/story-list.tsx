"use client";

import { BookOpenText, CalendarClock, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { StoryListItem } from "@/actions/stories/_types";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import day from "@/lib/dayjs";

type StoryListProps = {
  stories: StoryListItem[];
};

export function StoryList({ stories }: StoryListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredStories = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return stories;
    }

    return stories.filter((story) => {
      const searchableText = `${story.name} ${story.description}`.toLowerCase();
      return searchableText.includes(query);
    });
  }, [stories, searchQuery]);

  const hasStories = stories.length > 0;

  return (
    <section
      aria-labelledby="stories-heading"
      className="flex min-h-0 flex-1 flex-col py-6"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 id="stories-heading" className="font-serif text-title">
            Stories
          </h1>
          <p className="mt-1 text-body text-muted-foreground">
            {hasStories
              ? `${filteredStories.length} of ${stories.length} ${
                  stories.length === 1 ? "story" : "stories"
                }`
              : "No stories yet"}
          </p>
        </div>

        {hasStories ? (
          <div className="relative min-w-0 sm:w-80">
            <Search
              aria-hidden="true"
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label="Search stories"
              autoComplete="off"
              className="h-10 pl-9"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search title or description"
              type="search"
              value={searchQuery}
            />
            {searchQuery ? (
              <Button
                aria-label="Clear search"
                className="-translate-y-1/2 absolute top-1/2 right-1 size-8"
                onClick={() => setSearchQuery("")}
                size="icon"
                tooltip="Clear search"
                variant="ghost"
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-7 flex-1">
        {!hasStories ? (
          <StoryEmptyState
            body="Stories you create will appear here with their description and last updated time."
            icon="book"
            title="No stories yet"
          />
        ) : filteredStories.length === 0 ? (
          <StoryEmptyState
            body={`No title or description matches "${searchQuery.trim()}".`}
            icon="search"
            title="No matching stories"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredStories.map((story) => (
              <Link
                aria-label={`Open ${story.name}`}
                className="flex flex-col rounded-lg border border-border/80 bg-card/80 p-4 shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-ring/45 hover:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
                href={`/story/${story.id}`}
                key={story.id}
              >
                <h3 className="min-w-0 break-words font-serif text-heading">
                  {story.name}
                </h3>

                {story.description ? (
                  <p className="mt-2.5 line-clamp-2 text-label text-muted-foreground">
                    {story.description}
                  </p>
                ) : null}

                <p className="mt-auto flex items-center gap-1.5 pt-3 text-caption text-muted-foreground">
                  <CalendarClock aria-hidden="true" className="size-3.5" />
                  <span>Last updated {formatUpdatedAt(story.updatedAt)}</span>
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StoryEmptyState({
  body,
  icon,
  title,
}: {
  body: string;
  icon: "book" | "search";
  title: string;
}) {
  const Icon = icon === "book" ? BookOpenText : Search;

  return (
    <div className="flex min-h-80 items-center justify-center rounded-lg border border-border/80 bg-card/45 px-panel py-12 text-center">
      <div className="max-w-md">
        <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border/80 bg-muted/70 text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <h3 className="mt-5 font-serif text-title">{title}</h3>
        <p className="mt-3 text-body text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function formatUpdatedAt(updatedAt: string) {
  const date = day(updatedAt);

  if (!date.isValid()) {
    return "recently";
  }

  return date.format("lll");
}
