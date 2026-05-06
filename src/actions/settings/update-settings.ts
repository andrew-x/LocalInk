"use server";

import { revalidatePath } from "next/cache";

import { publicActionClient } from "@/lib/action";
import { updateAppSettings } from "@/lib/server/app-settings";

import { settingsFormSchema } from "./_schemas";
import type { AppSettings } from "./_types";

export const updateSettings = publicActionClient
  .metadata({ action: "update-settings" })
  .inputSchema(settingsFormSchema)
  .action(async ({ parsedInput }): Promise<AppSettings> => {
    const settings = await updateAppSettings(parsedInput);

    revalidatePath("/");

    return settings;
  });
