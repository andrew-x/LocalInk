import path from "node:path";

export const DRIZZLE_SCHEMA_PATH = "./src/lib/drizzle/schema.ts";
export const DRIZZLE_MIGRATIONS_PATH = "./src/lib/drizzle/migrations";

export const LOCALINK_DATA_MODES = ["dev", "prod"] as const;
export const DEFAULT_LOCALINK_DATA_MODE: LocalinkDataMode = "dev";
export const DATABASE_FILENAME = "localink.sqlite";

export type LocalinkDataMode = (typeof LOCALINK_DATA_MODES)[number];

export type LocalinkDatabaseInfo = {
  mode: LocalinkDataMode;
  dataDirectory: string;
  databasePath: string;
};

export function getLocalinkDataMode(
  env: NodeJS.ProcessEnv = process.env,
): LocalinkDataMode {
  const rawMode = env.LOCALINK_DATA_MODE?.trim();

  if (!rawMode) {
    return DEFAULT_LOCALINK_DATA_MODE;
  }

  const mode = rawMode.toLowerCase();

  if (isLocalinkDataMode(mode)) {
    return mode;
  }

  throw new Error(
    `Invalid LOCALINK_DATA_MODE "${rawMode}". Expected "dev" or "prod".`,
  );
}

export function getDataDirectory(
  mode: LocalinkDataMode = getLocalinkDataMode(),
  rootDirectory = process.cwd(),
): string {
  return path.join(rootDirectory, "data", mode);
}

export function getDatabasePath(
  mode: LocalinkDataMode = getLocalinkDataMode(),
  rootDirectory = process.cwd(),
): string {
  return path.join(getDataDirectory(mode, rootDirectory), DATABASE_FILENAME);
}

export function getMigrationsPath(rootDirectory = process.cwd()): string {
  return path.join(rootDirectory, "src", "lib", "drizzle", "migrations");
}

export function getDatabaseInfo(
  mode: LocalinkDataMode = getLocalinkDataMode(),
  rootDirectory = process.cwd(),
): LocalinkDatabaseInfo {
  const dataDirectory = getDataDirectory(mode, rootDirectory);

  return {
    mode,
    dataDirectory,
    databasePath: path.join(dataDirectory, DATABASE_FILENAME),
  };
}

function isLocalinkDataMode(mode: string): mode is LocalinkDataMode {
  return LOCALINK_DATA_MODES.includes(mode as LocalinkDataMode);
}
