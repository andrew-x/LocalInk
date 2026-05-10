"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { deleteGeneratedImagesByIds } from "@/lib/server/generated-images";

import { deleteGeneratedImagesActionSchema } from "./_schemas";
import type { DeleteGeneratedImagesResult } from "./_types";

export const deleteGeneratedImages = publicActionClient
  .metadata({ action: "delete-generated-images" })
  .inputSchema(deleteGeneratedImagesActionSchema)
  .action(async ({ parsedInput }): Promise<DeleteGeneratedImagesResult> => {
    const images = await deleteGeneratedImagesByIds(parsedInput.ids);

    revalidatePath("/images");
    revalidatePath("/images/generate");

    for (const image of images) {
      revalidatePath(`/images/${image.id}`);
    }

    return {
      ids: images.map((image) => image.id),
    };
  });
