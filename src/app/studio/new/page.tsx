import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { getStudioWorkspace } from "@/actions/studio/get-studio-workspace";
import { AppHeader } from "@/components/app/app-header";
import { NewStoryFlow } from "@/components/studio/new-story/new-story-flow";

type NewStudioStoryPageProps = {
  searchParams: Promise<{ storyId?: string | string[] }>;
};

export default async function NewStudioStoryPage({
  searchParams,
}: NewStudioStoryPageProps) {
  await connection();

  const { storyId } = await searchParams;
  const resumeId = Array.isArray(storyId) ? storyId[0] : storyId;
  let resume: { id: string; title: string } | null = null;

  if (resumeId) {
    const workspace = await getStudioWorkspace(resumeId);
    if (!workspace) notFound();
    if (workspace.story.setupStatus !== "draft") {
      redirect(`/studio/${workspace.story.id}`);
    }
    resume = { id: workspace.story.id, title: workspace.story.title };
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-workspace flex-col px-page py-5 md:py-7">
        <AppHeader />
        <NewStoryFlow resume={resume} />
      </div>
    </main>
  );
}
