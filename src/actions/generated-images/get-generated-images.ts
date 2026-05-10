"use server";

import { runLoggedAction } from "@/lib/action";
import { getGeneratedImageList } from "@/lib/server/generated-images";

import type { GeneratedImageListItem } from "./_types";

export async function getGeneratedImages(): Promise<GeneratedImageListItem[]> {
  return runLoggedAction({ action: "get-generated-images" }, async () =>
    getGeneratedImageList(),
  );
}
