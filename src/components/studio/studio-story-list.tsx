"use client";

import { BookOpenText, CalendarClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import type { StudioStoryListItem } from "@/actions/studio/_types";
import { deleteStudioStory } from "@/actions/studio/delete-studio-story";
import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";
import { useRunStudioAction } from "@/components/studio/workspace/use-studio-store";
import day from "@/lib/dayjs";

const DELETE_FAILED_MESSAGE = "The story could not be deleted.";

export function StudioStoryList({
  stories: initialStories,
}: {
  stories: StudioStoryListItem[];
}) {
  const run = useRunStudioAction();
  // Deleted ids are hidden right away; the refreshed list drops them too.
  const [deletedIds, setDeletedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingDelete, setPendingDelete] =
    useState<StudioStoryListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const stories = useMemo(
    () => initialStories.filter((story) => !deletedIds.has(story.id)),
    [deletedIds, initialStories],
  );

  async function confirmDelete() {
    const story = pendingDelete;
    if (!story || isDeleting) return;
    setIsDeleting(true);
    try {
      const deleted = await run(
        deleteStudioStory({ storyId: story.id }),
        DELETE_FAILED_MESSAGE,
      );
      if (!deleted) return;
      setDeletedIds((current) => new Set(current).add(deleted.storyId));
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  }

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
              <div className="group/story relative flex" key={story.id}>
                <Link
                  aria-label={`Open ${story.title}`}
                  className="flex flex-1 flex-col rounded-lg border border-border/80 bg-card/80 p-4 shadow-sm transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-ring/45 hover:bg-card focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35"
                  href={
                    story.setupStatus === "draft"
                      ? `/studio/new?storyId=${encodeURIComponent(story.id)}`
                      : `/studio/${story.id}`
                  }
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

                  {/* Right padding leaves room for the delete button. */}
                  <p className="mt-auto flex items-center gap-1.5 pt-3 pr-8 text-caption text-muted-foreground">
                    <CalendarClock aria-hidden="true" className="size-3.5" />
                    {/* Relative time can tick between server and client render. */}
                    <span suppressHydrationWarning>
                      Updated {formatUpdatedAt(story.updatedAt)}
                    </span>
                  </p>
                </Link>
                <Button
                  aria-label={`Delete ${story.title}`}
                  className="absolute right-2 bottom-2 size-7 opacity-0 focus-visible:opacity-100 group-focus-within/story:opacity-100 group-hover/story:opacity-100"
                  onClick={() => setPendingDelete(story)}
                  size="icon"
                  tooltip="Delete story"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
        open={pendingDelete !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this story?</DialogTitle>
            <DialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and everything in it (its
              Bible, plan, prose, and saved versions) are permanently deleted.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setPendingDelete(null)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              loading={isDeleting}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function formatUpdatedAt(updatedAt: string) {
  const date = day(updatedAt);
  return date.isValid() ? date.fromNow() : "recently";
}
