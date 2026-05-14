"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { generateAndStoreGeneratedImage } from "@/lib/server/generated-images";

import { generateImageActionSchema } from "./_schemas";
import type { GeneratedImageDetail } from "./_types";

export const generateImage = publicActionClient
  .metadata({ action: "generate-image" })
  .inputSchema(generateImageActionSchema)
  .action(async ({ parsedInput }): Promise<GeneratedImageDetail> => {
    const image = await generateAndStoreGeneratedImage(parsedInput);

    revalidatePath("/images");
    revalidatePath(`/images/${image.id}`);

    return image;
  });
