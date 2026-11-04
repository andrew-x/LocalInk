import { Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { getStudioStories } from "@/actions/studio/get-studio-stories";
import { AppHeader } from "@/components/app/app-header";
import { Button } from "@/components/common/button";
import { StudioStoryList } from "@/components/studio/studio-story-list";

export default async function StudioPage() {
  await connection();

  const stories = await getStudioStories();

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-workspace flex-col px-page py-5 md:py-7">
        <AppHeader
          actions={
            <Button asChild className="w-full sm:w-auto" size="lg">
              <Link href="/studio/new">
                <Plus aria-hidden="true" />
                New story
              </Link>
            </Button>
          }
        />

        <StudioStoryList stories={stories} />
      </div>
    </main>
  );
}
