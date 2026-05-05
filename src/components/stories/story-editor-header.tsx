import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import type { StoryEditorData } from "@/actions/stories/_types";
import { Button } from "@/components/common/button";
import { EditStoryDetailsDialog } from "@/components/stories/edit-story-details-dialog";

type StoryEditorHeaderProps = {
  story: Pick<StoryEditorData, "id" | "name" | "description">;
};

export function StoryEditorHeader({ story }: StoryEditorHeaderProps) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-border/80 border-b bg-background/95 px-page py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          aria-label="Back to stories"
          asChild
          className="-ml-1 size-7 text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground"
          size="icon"
          tooltip="Back to stories"
          tooltipSide="bottom"
          variant="ghost"
        >
          <Link href="/">
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </Link>
        </Button>

        <div className="min-w-0">
          <h1 className="truncate font-serif text-heading">{story.name}</h1>
          <p className="truncate text-caption text-muted-foreground">
            {story.description || "No description"}
          </p>
        </div>
      </div>

      <EditStoryDetailsDialog story={story} />
    </header>
  );
}
