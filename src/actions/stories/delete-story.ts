"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { ActionError } from "@/lib/action-error";
import { getDb } from "@/lib/drizzle/db";
import { stories } from "@/lib/drizzle/schema";

import { deleteStoryActionSchema } from "./_schemas";

type DeletedStory = {
  id: string;
};

export const deleteStory = publicActionClient
  .metadata({ action: "delete-story" })
  .inputSchema(deleteStoryActionSchema)
  .action(async ({ parsedInput }): Promise<DeletedStory> => {
    const [deletedStory] = await getDb()
      .delete(stories)
      .where(eq(stories.id, parsedInput.id))
      .returning({
        id: stories.id,
      });

    if (!deletedStory) {
      throw new ActionError("BAD_REQUEST", "The story could not be found.");
    }

    revalidatePath("/");
    revalidatePath(`/story/${deletedStory.id}`);

    return deletedStory;
  });
