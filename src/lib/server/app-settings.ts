import "server-only";

import { eq } from "drizzle-orm";

import type { AppSettings } from "@/actions/settings/_types";
import day from "@/lib/dayjs";
import { getDb } from "@/lib/drizzle/db";
import { metadata as metadataTable } from "@/lib/drizzle/schema";

const AI_SYSTEM_INSTRUCTIONS_KEY = "ai.systemInstructions";

export async function getAppSettings(): Promise<AppSettings> {
  return {
    systemInstructions: await getSystemInstructions(),
  };
}

export async function updateAppSettings(
  settings: AppSettings,
): Promise<AppSettings> {
  const systemInstructions = settings.systemInstructions.trim();
  const now = day().toISOString();

  await getDb()
    .insert(metadataTable)
    .values({
      key: AI_SYSTEM_INSTRUCTIONS_KEY,
      value: systemInstructions,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: metadataTable.key,
      set: {
        value: systemInstructions,
        updatedAt: now,
      },
    });

  return {
    systemInstructions,
  };
}

export async function getSystemInstructions(): Promise<string> {
  const [setting] = await getDb()
    .select({
      value: metadataTable.value,
    })
    .from(metadataTable)
    .where(eq(metadataTable.key, AI_SYSTEM_INSTRUCTIONS_KEY))
    .limit(1);

  return setting?.value ?? "";
}
