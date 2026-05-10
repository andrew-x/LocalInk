"use server";

import { runLoggedAction } from "@/lib/action";
import { getLatestGeneratedImageListItem } from "@/lib/server/generated-images";

import type { GeneratedImageListItem } from "./_types";

export async function getLatestGeneratedImage(): Promise<GeneratedImageListItem | null> {
  return runLoggedAction({ action: "get-latest-generated-image" }, async () =>
    getLatestGeneratedImageListItem(),
  );
}
