"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { deleteGeneratedImageById } from "@/lib/server/generated-images";

import { deleteGeneratedImageActionSchema } from "./_schemas";
import type { GeneratedImageDetail } from "./_types";

export const deleteGeneratedImage = publicActionClient
  .metadata({ action: "delete-generated-image" })
  .inputSchema(deleteGeneratedImageActionSchema)
  .action(async ({ parsedInput }): Promise<GeneratedImageDetail> => {
    const image = await deleteGeneratedImageById(parsedInput.id);

    revalidatePath("/images");
    revalidatePath("/images/generate");
    revalidatePath(`/images/${image.id}`);

    return image;
  });
