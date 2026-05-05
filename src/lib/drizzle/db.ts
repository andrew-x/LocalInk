import "server-only";

import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { getDatabaseInfo } from "./paths";
import * as schema from "./schema";

const createDb = (client: Database.Database) => drizzle(client, { schema });

export type LocalinkDb = ReturnType<typeof createDb>;

const globalForDrizzle = globalThis as typeof globalThis & {
  __localinkDb?: LocalinkDb;
  __localinkSqlite?: Database.Database;
};

export function getSqliteClient(): Database.Database {
  if (!globalForDrizzle.__localinkSqlite) {
    const { dataDirectory, databasePath } = getDatabaseInfo();

    mkdirSync(dataDirectory, { recursive: true });

    const client = new Database(databasePath);

    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");

    globalForDrizzle.__localinkSqlite = client;
  }

  return globalForDrizzle.__localinkSqlite;
}

export function getDb(): LocalinkDb {
  if (!globalForDrizzle.__localinkDb) {
    globalForDrizzle.__localinkDb = createDb(getSqliteClient());
  }

  return globalForDrizzle.__localinkDb;
}
