import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getStory } from "@/actions/stories/get-story";
import { StoryEditor } from "@/components/stories/story-editor";
import { StoryEditorHeader } from "@/components/stories/story-editor-header";

type StoryPageProps = {
  params: Promise<{
    storyId: string;
  }>;
};

export default async function StoryPage({ params }: StoryPageProps) {
  await connection();

  const { storyId } = await params;
  const story = await getStory(storyId);

  if (!story) {
    notFound();
  }

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <StoryEditorHeader story={story} />
      <StoryEditor story={story} />
    </main>
  );
}
