// @ts-expect-error Bun provides this module at test runtime.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// Exercise the real migration, action validation, writes, and reads against an
// isolated database. Module replacements stay out of the other test suites.
test("backstory migrates safely, persists through unrelated edits, and clears explicitly", () => {
  const script = `
    import { mock } from "bun:test";
    import { Database } from "bun:sqlite";
    import { readFileSync } from "node:fs";
    import { drizzle } from "drizzle-orm/bun-sqlite";
    mock.module("server-only", () => ({}));
    mock.module("next/cache", () => ({ revalidatePath() {} }));
    mock.module("@/lib/logger", () => ({ createLogger: () => ({ info() {}, error() {} }) }));
    const client = new Database(":memory:");
    const migrationsPath = "src/lib/drizzle/migrations/";
    const journal = JSON.parse(readFileSync(migrationsPath + "meta/_journal.json", "utf8"));
    let migratedLegacyStory;
    for (const entry of journal.entries) {
      if (entry.tag === "0007_story-backstory") {
        client.query("INSERT INTO stories (id, name, description, style) VALUES (?, ?, ?, ?)").run("legacy", "Legacy story", "Original description", "Original style");
      }
      client.exec(readFileSync(migrationsPath + entry.tag + ".sql", "utf8"));
      if (entry.tag === "0007_story-backstory") {
        migratedLegacyStory = client.query("SELECT name, description, style, backstory FROM stories WHERE id = ?").get("legacy");
      }
    }
    const db = drizzle(client);
    mock.module("@/lib/drizzle/db", () => ({ getDb: () => db }));
    const { createStory } = await import("@/actions/stories/create-story");
    const { updateStory } = await import("@/actions/stories/update-story");
    const { getStory } = await import("@/actions/stories/get-story");
    const requireData = (result) => {
      if (!result?.data) throw new Error("Expected successful story action: " + JSON.stringify(result));
      return result.data;
    };
    const withBackstory = requireData(await createStory({
      name: "Shared history", description: "", backstory: "  Mira once sheltered Sol.  ",
    }));
    const created = await getStory(withBackstory.id);
    const withoutBackstory = requireData(await createStory({ name: "New story", description: "" }));
    const createdDefault = await getStory(withoutBackstory.id);
    const identity = { id: withBackstory.id, name: withBackstory.name, description: "" };
    const contextEdits = [
      { style: "Close third person." },
      { characters: [{ id: "mira", name: "Mira", description: "A former smuggler." }] },
      { locations: [{ id: "harbor", name: "Harbor", description: "Their former home." }] },
      { systemInstructions: "Use restrained exposition." },
      { voiceExemplars: [{ id: "sample", label: "Sample", text: "The boat had already gone." }] },
    ];
    const preserved = [];
    for (const edit of contextEdits) {
      const saved = requireData(await updateStory({ ...identity, ...edit }));
      preserved.push({ returned: saved.backstory, reloaded: (await getStory(identity.id)).backstory });
    }
    const updated = requireData(await updateStory({ ...identity, backstory: "  Sol still owes Mira a favor.  " }));
    const contextAfterUpdate = await getStory(identity.id);
    const cleared = requireData(await updateStory({ ...identity, backstory: "   " }));
    const reloadedAfterClear = await getStory(identity.id);
    client.close();
    console.log(JSON.stringify({
      migratedLegacyStory, createdBackstory: created.backstory, createdDefault: createdDefault.backstory,
      preserved, updatedBackstory: updated.backstory,
      retainedContext: {
        style: contextAfterUpdate.style,
        character: contextAfterUpdate.characters[0].name,
        location: contextAfterUpdate.locations[0].name,
        systemInstructions: contextAfterUpdate.systemInstructions,
        voiceExemplar: contextAfterUpdate.voiceExemplars[0].text,
      },
      clearedBackstory: cleared.backstory, reloadedAfterClear: reloadedAfterClear.backstory,
    }));
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 20_000,
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    migratedLegacyStory: {
      name: "Legacy story",
      description: "Original description",
      style: "Original style",
      backstory: "",
    },
    createdBackstory: "Mira once sheltered Sol.",
    createdDefault: "",
    preserved: Array.from({ length: 5 }, () => ({
      returned: "Mira once sheltered Sol.",
      reloaded: "Mira once sheltered Sol.",
    })),
    updatedBackstory: "Sol still owes Mira a favor.",
    retainedContext: {
      style: "Close third person.",
      character: "Mira",
      location: "Harbor",
      systemInstructions: "Use restrained exposition.",
      voiceExemplar: "The boat had already gone.",
    },
    clearedBackstory: "",
    reloadedAfterClear: "",
  });
});
