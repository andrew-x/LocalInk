import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { getStudioWorkspace } from "@/actions/studio/get-studio-workspace";
import { StudioWorkspace } from "@/components/studio/workspace/studio-workspace";
import { getSystemInstructions } from "@/lib/server/app-settings";

type StudioWorkspacePageProps = {
  params: Promise<{ studioStoryId: string }>;
};

export default async function StudioWorkspacePage({
  params,
}: StudioWorkspacePageProps) {
  await connection();

  const { studioStoryId } = await params;
  const workspace = await getStudioWorkspace(studioStoryId);

  if (!workspace) notFound();
  if (workspace.story.setupStatus === "draft") {
    redirect(`/studio/new?storyId=${encodeURIComponent(workspace.story.id)}`);
  }

  const globalInstructions = await getSystemInstructions();

  return (
    <main className="flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <StudioWorkspace
        globalInstructions={globalInstructions}
        initial={workspace}
        key={workspace.story.id}
      />
    </main>
  );
}
