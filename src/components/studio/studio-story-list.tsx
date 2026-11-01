import { BookOpenText, CalendarClock } from "lucide-react";
import Link from "next/link";

import type { StudioStoryListItem } from "@/actions/studio/_types";
import day from "@/lib/dayjs";

export function StudioStoryList({
  stories,
}: {
  stories: StudioStoryListItem[];
}) {
  return (
    <section
      aria-labelledby="studio-stories-heading"
      className="flex min-h-0 flex-1 flex-col py-6"
    >
      <div>
        <h1 className="font-serif text-title" id="studio-stories-heading">
          Story Studio
        </h1>
        <p className="mt-1 text-body text-muted-foreground">
          {stories.length > 0
            ? `${stories.length} ${stories.length === 1 ? "story" : "stories"}`
            : "No stories yet"}
        </p>
      </div>

      <div className="mt-7 flex-1">
        {stories.length === 0 ? (
          <div className="flex min-h-80 items-center justify-center rounded-lg border border-border/80 bg-card/45 px-panel py-12 text-center">
            <div className="max-w-md">
              <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-border/80 bg-muted/70 text-muted-foreground">
                <BookOpenText aria-hidden="true" className="size-5" />
              </div>
              <h2 className="mt-5 font-serif text-title">No stories yet</h2>
              <p className="mt-3 text-body text-muted-foreground">
                Start with a brain dump and the studio will help shape it into a
                plan you can write from.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {stories.map((story) => (
              <Link
                aria-label={`Open ${story.title}`}
                className="flex flex-col rounded-lg border border-border/80 bg-card/80 p-4 shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-ring/45 hover:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
                href={
                  story.setupStatus === "draft"
                    ? `/studio/new?storyId=${encodeURIComponent(story.id)}`
                    : `/studio/${story.id}`
                }
                key={story.id}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-serif text-heading">
                    {story.title}
                  </h3>
                  {story.setupStatus === "draft" ? (
                    <span className="shrink-0 rounded-md border border-border/80 bg-muted/70 px-2 py-0.5 text-caption text-muted-foreground">
                      Draft
                    </span>
                  ) : null}
                </div>

                {story.overview ? (
                  <p className="mt-2.5 line-clamp-2 text-label text-muted-foreground">
                    {story.overview}
                  </p>
                ) : null}

                <p className="mt-auto flex items-center gap-1.5 pt-3 text-caption text-muted-foreground">
                  <CalendarClock aria-hidden="true" className="size-3.5" />
                  <span>Updated {formatUpdatedAt(story.updatedAt)}</span>
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function formatUpdatedAt(updatedAt: string) {
  const date = day(updatedAt);
  return date.isValid() ? date.fromNow() : "recently";
}
