import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

import {
  DRIZZLE_MIGRATIONS_PATH,
  DRIZZLE_SCHEMA_PATH,
  getDatabasePath,
} from "./src/lib/drizzle/paths";

loadEnvConfig(process.cwd());

const databasePath = getDatabasePath();

mkdirSync(dirname(databasePath), { recursive: true });

export default defineConfig({
  schema: DRIZZLE_SCHEMA_PATH,
  out: DRIZZLE_MIGRATIONS_PATH,
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
