import Image from "next/image";
import { connection } from "next/server";

import { getSettings } from "@/actions/settings/get-settings";
import { getStories } from "@/actions/stories/get-stories";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { CreateStoryDialog } from "@/components/stories/create-story-dialog";
import { StoryList } from "@/components/stories/story-list";

export default async function Home() {
  await connection();

  const [settings, stories] = await Promise.all([getSettings(), getStories()]);

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
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <SettingsDialog settings={settings} />
            <CreateStoryDialog />
          </div>
        </header>

        <StoryList stories={stories} />
      </div>
    </main>
  );
}
