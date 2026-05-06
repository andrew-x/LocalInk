"use server";

import { runLoggedAction } from "@/lib/action";
import { getAppSettings } from "@/lib/server/app-settings";

import type { AppSettings } from "./_types";

export async function getSettings(): Promise<AppSettings> {
  return runLoggedAction({ action: "get-settings" }, getAppSettings);
}
