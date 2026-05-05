import Image from "next/image";
import { connection } from "next/server";

import { getStories } from "@/actions/stories/get-stories";
import { CreateStoryDialog } from "@/components/stories/create-story-dialog";
import { StoryList } from "@/components/stories/story-list";

export default async function Home() {
  await connection();

  const stories = await getStories();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-workspace flex-col px-page py-5 md:py-7">
        <header className="flex flex-col gap-4 border-border/80 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
          <Image
            alt="LocalInk"
            className="h-9 w-auto max-w-44"
            height={36}
            priority
            src="/logo.svg"
            width={169}
          />
          <CreateStoryDialog />
        </header>

        <StoryList stories={stories} />
      </div>
    </main>
  );
}
