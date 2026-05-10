"use server";

import { runLoggedAction } from "@/lib/action";
import { getGeneratedImageById } from "@/lib/server/generated-images";

import type { GeneratedImageDetail } from "./_types";

export async function getGeneratedImage(
  id: string,
): Promise<GeneratedImageDetail | null> {
  return runLoggedAction({ action: "get-generated-image" }, async () => {
    const imageId = id.trim();

    if (!imageId) {
      return null;
    }

    return getGeneratedImageById(imageId);
  });
}
