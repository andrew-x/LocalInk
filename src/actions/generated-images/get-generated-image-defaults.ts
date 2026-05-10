"use server";

import { runLoggedAction } from "@/lib/action";
import { getGeneratedImageDefaults as getServerGeneratedImageDefaults } from "@/lib/server/generated-images";

import type { GeneratedImageDefaults } from "./_types";

export async function getGeneratedImageDefaults(): Promise<GeneratedImageDefaults> {
  return runLoggedAction({ action: "get-generated-image-defaults" }, async () =>
    getServerGeneratedImageDefaults(),
  );
}
