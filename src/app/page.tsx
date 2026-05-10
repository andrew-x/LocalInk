import { connection } from "next/server";

import { getSettings } from "@/actions/settings/get-settings";
import { getStories } from "@/actions/stories/get-stories";
import { AppHeader } from "@/components/app/app-header";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { CreateStoryDialog } from "@/components/stories/create-story-dialog";
import { StoryList } from "@/components/stories/story-list";

export default async function Home() {
  await connection();

  const [settings, stories] = await Promise.all([getSettings(), getStories()]);

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-workspace flex-col px-page py-5 md:py-7">
        <AppHeader
          actions={
            <>
              <SettingsDialog settings={settings} />
              <CreateStoryDialog />
            </>
          }
        />

        <StoryList stories={stories} />
      </div>
    </main>
  );
}
