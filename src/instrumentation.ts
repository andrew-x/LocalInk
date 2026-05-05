export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { runDrizzleMigrations } = await import("./lib/drizzle/migrate");

  runDrizzleMigrations();
}
