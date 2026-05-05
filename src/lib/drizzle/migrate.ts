import "server-only";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createLogger } from "../logger";
import { getDb } from "./db";
import { getDatabaseInfo, getMigrationsPath } from "./paths";

const globalForMigrations = globalThis as typeof globalThis & {
  __localinkDrizzleMigrated?: boolean;
};

const migrationLogger = createLogger("drizzle");

export function runDrizzleMigrations() {
  if (globalForMigrations.__localinkDrizzleMigrated) {
    return;
  }

  const databaseInfo = getDatabaseInfo();
  const migrationsFolder = getMigrationsPath();

  migrate(getDb(), {
    migrationsFolder,
  });

  globalForMigrations.__localinkDrizzleMigrated = true;

  migrationLogger.info("migrate", {
    mode: databaseInfo.mode,
    databasePath: databaseInfo.databasePath,
    migrationsFolder,
  });
}
