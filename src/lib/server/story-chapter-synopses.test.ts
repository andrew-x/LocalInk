// @ts-expect-error Bun provides this module at test runtime.
import { Database } from "bun:sqlite";
// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/bun-sqlite";

import type { LocalinkDb } from "@/lib/drizzle/db";
import type { StoryProseGenerationRequest } from "@/lib/story-prose-generation-contract";

mock.module("server-only", () => ({}));

const content = "Mara discovers the hidden door. ".repeat(30);

async function fixture() {
  const helpers = await import("./story-chapter-synopses");
  const client = new Database(":memory:");
  client.exec(`CREATE TABLE chapters (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, name TEXT NOT NULL,
    position INTEGER NOT NULL, content TEXT NOT NULL,
    synopsis TEXT NOT NULL DEFAULT '', synopsis_source_hash TEXT NOT NULL DEFAULT '',
    synopsis_updated_at TEXT, updated_at TEXT NOT NULL DEFAULT ''
  )`);
  client
    .query(
      "INSERT INTO chapters (id, story_id, name, position, content) VALUES (?, ?, ?, ?, ?)",
    )
    .run("chapter", "story", "The Door", 1, content);
  // These helpers use the common SQLite query surface; Bun runs its own driver.
  const db = drizzle(client) as unknown as LocalinkDb;
  const input = { chapterId: "chapter", storyId: "story" };
  return {
    ...helpers,
    client,
    db,
    input,
    read: () =>
      client.query("SELECT * FROM chapters WHERE id = 'chapter'").get(),
  };
}

describe("chapter synopsis generation", () => {
  test("summarizes the complete eligible source and rejects incomplete output", async () => {
    const { generateStoryChapterSynopsis, getChapterSynopsisSourceHash } =
      await import("./story-chapter-synopses");
    for (const finishReason of [
      "length",
      "content-filter",
      "error",
      "other",
      "tool-calls",
    ]) {
      expect(
        await generateStoryChapterSynopsis({
          content,
          name: "Door",
          generateText: async () => ({ text: "Partial summary", finishReason }),
        }),
      ).toBeNull();
    }
    expect(
      await generateStoryChapterSynopsis({
        content,
        name: "Door",
        generateText: async () => ({ text: "   ", finishReason: "stop" }),
      }),
    ).toBeNull();
    expect(
      await generateStoryChapterSynopsis({
        content: `  ${content}  `,
        name: "Door",
        generateText: async (options) => {
          expect(options.prompt).toContain(content.trim());
          return { text: " Mara finds a door. ", finishReason: "stop" };
        },
      }),
    ).toEqual({
      synopsis: "Mara finds a door.",
      sourceHash: getChapterSynopsisSourceHash(content),
    });
  });

  test("does not call a model for too-short or oversized sources", async () => {
    const { generateStoryChapterSynopsis } = await import(
      "./story-chapter-synopses"
    );
    for (const source of ["x".repeat(599), "x".repeat(60_001)]) {
      expect(
        await generateStoryChapterSynopsis({
          content: source,
          name: "Door",
          generateText: async () => {
            throw new Error("Model must not run");
          },
        }),
      ).toBeNull();
    }
  });

  test("accepts both source-size boundaries without omitting the middle", async () => {
    const { generateStoryChapterSynopsis } = await import(
      "./story-chapter-synopses"
    );
    for (const length of [600, 60_000]) {
      const source = "x".repeat(length);
      expect(
        await generateStoryChapterSynopsis({
          content: source,
          name: "Door",
          generateText: async (options) => {
            expect(options.prompt).toContain(source);
            return { text: "Complete summary", finishReason: "stop" };
          },
        }),
      ).not.toBeNull();
    }
  });
});

describe("chapter synopsis refresh concurrency", () => {
  test("does not replace the cache when generation produces no complete summary", async () => {
    const f = await fixture();
    try {
      f.client.exec(
        "UPDATE chapters SET synopsis = 'Old summary', synopsis_source_hash = 'old'",
      );
      expect(
        await f.refreshStoryChapterSynopsis(f.input, {
          db: f.db,
          generate: async () => null,
        }),
      ).toEqual({ didRefresh: false });
      expect(f.read()).toMatchObject({
        synopsis: "Old summary",
        synopsis_source_hash: "old",
      });
    } finally {
      f.client.close();
    }
  });

  test("clears obsolete summaries after shortening or oversizing a chapter", async () => {
    const f = await fixture();
    try {
      for (const source of ["short", "x".repeat(60_001)]) {
        f.client
          .query(
            "UPDATE chapters SET content = ?, synopsis = 'obsolete', synopsis_source_hash = 'old', synopsis_updated_at = 'old'",
          )
          .run(source);
        expect(
          await f.refreshStoryChapterSynopsis(f.input, {
            db: f.db,
            generate: async () => {
              throw new Error("Model must not run");
            },
          }),
        ).toEqual({ didRefresh: true });
        expect(f.read()).toMatchObject({
          synopsis: "",
          synopsis_source_hash: "",
          synopsis_updated_at: null,
        });
      }
    } finally {
      f.client.close();
    }
  });

  test("does not overwrite an edit, newer summary, or deleted chapter", async () => {
    for (const mutation of [
      "UPDATE chapters SET content = 'new manuscript'",
      "UPDATE chapters SET synopsis = 'newer summary', synopsis_source_hash = 'new hash'",
      "DELETE FROM chapters",
    ]) {
      const f = await fixture();
      try {
        expect(
          await f.refreshStoryChapterSynopsis(f.input, {
            db: f.db,
            generate: async () => {
              f.client.exec(mutation);
              return {
                synopsis: "Late summary",
                sourceHash: f.getChapterSynopsisSourceHash(content),
              };
            },
          }),
        ).toEqual({ didRefresh: false });
        expect(f.read()?.synopsis).not.toBe("Late summary");
      } finally {
        f.client.close();
      }
    }
  });

  test("refreshes stale and empty caches but reuses a current nonempty cache", async () => {
    const f = await fixture();
    try {
      let calls = 0;
      const dependencies = {
        db: f.db,
        generate: async () => {
          calls += 1;
          return {
            synopsis: "Current summary",
            sourceHash: f.getChapterSynopsisSourceHash(content),
          };
        },
      };
      expect(
        await f.refreshStoryChapterSynopsis(f.input, dependencies),
      ).toEqual({ didRefresh: true });
      expect(
        await f.refreshStoryChapterSynopsis(f.input, dependencies),
      ).toEqual({ didRefresh: false });
      f.client.exec("UPDATE chapters SET synopsis = ''");
      expect(
        await f.refreshStoryChapterSynopsis(f.input, dependencies),
      ).toEqual({ didRefresh: true });
      expect(calls).toBe(2);
    } finally {
      f.client.close();
    }
  });
});

describe("server-prepared prose synopsis context", () => {
  test("rejects legacy caches whose completion was never verified", async () => {
    const f = await fixture();
    const { prepareStoryProseContext } = await import("./story-prose-context");
    try {
      const legacyHash = createHash("sha256")
        .update(content.trim())
        .digest("hex");
      f.client
        .query(
          "UPDATE chapters SET synopsis = 'Legacy summary', synopsis_source_hash = ?",
        )
        .run(legacyHash);
      expect(f.isChapterSynopsisStale(content, legacyHash)).toBe(true);
      expect(
        (await prepareStoryProseContext(request(content), f.db)).focusedChapter
          .synopsis,
      ).toBe("");
    } finally {
      f.client.close();
    }
  });

  test("ignores browser summaries and observes freshly stored summaries immediately", async () => {
    const f = await fixture();
    const { prepareStoryProseContext } = await import("./story-prose-context");
    const input = request(content);
    try {
      expect(
        (await prepareStoryProseContext(input, f.db)).focusedChapter.synopsis,
      ).toBe("");
      f.client
        .query("UPDATE chapters SET synopsis = ?, synopsis_source_hash = ?")
        .run("Fresh server summary", f.getChapterSynopsisSourceHash(content));
      const result = await prepareStoryProseContext(input, f.db);
      expect(result.focusedChapter.synopsis).toBe("Fresh server summary");
      expect(result.synopsisProvenance.get("chapter")).toBe(
        f.getChapterSynopsisSourceHash(content),
      );
      expect(input.focusedChapter.synopsis).toBe("Untrusted browser summary");
    } finally {
      f.client.close();
    }
  });

  test("focused unsaved edits win duplicate snapshots and invalidate old summaries", async () => {
    const f = await fixture();
    const { prepareStoryProseContext } = await import("./story-prose-context");
    try {
      f.client
        .query(
          "UPDATE chapters SET synopsis = 'Old summary', synopsis_source_hash = ?",
        )
        .run(f.getChapterSynopsisSourceHash(content));
      const input = request(content);
      input.chapters.push({ ...input.focusedChapter });
      input.focusedChapter = {
        ...input.focusedChapter,
        content: `${content}Mara closes the door.`,
      };
      const result = await prepareStoryProseContext(input, f.db);
      expect(result.chapters).toHaveLength(1);
      expect(result.chapters[0].content).toBe(input.focusedChapter.content);
      expect(result.focusedChapter.synopsis).toBe("");
      expect(result.synopsisProvenance.size).toBe(0);
    } finally {
      f.client.close();
    }
  });

  test("rejects wrong-story, missing, short, and oversized cached summaries", async () => {
    const f = await fixture();
    const { prepareStoryProseContext } = await import("./story-prose-context");
    try {
      for (const source of ["short", "x".repeat(60_001)]) {
        f.client
          .query(
            "UPDATE chapters SET synopsis = 'Invalid summary', synopsis_source_hash = ?",
          )
          .run(f.getChapterSynopsisSourceHash(source));
        expect(
          (await prepareStoryProseContext(request(source), f.db)).focusedChapter
            .synopsis,
        ).toBe("");
      }
      f.client
        .query(
          "UPDATE chapters SET synopsis = 'Other story', synopsis_source_hash = ?, story_id = 'another'",
        )
        .run(f.getChapterSynopsisSourceHash(content));
      expect(
        (await prepareStoryProseContext(request(content), f.db)).focusedChapter
          .synopsis,
      ).toBe("");
      f.client.exec("DELETE FROM chapters");
      expect(
        (await prepareStoryProseContext(request(content), f.db)).focusedChapter
          .synopsis,
      ).toBe("");
    } finally {
      f.client.close();
    }
  });
});

function request(source: string): StoryProseGenerationRequest {
  const focusedChapter = {
    id: "chapter",
    name: "The Door",
    position: 1,
    content: source,
    synopsis: "Untrusted browser summary",
  };
  return {
    story: {
      id: "story",
      name: "Story",
      description: "",
      systemInstructions: "",
      backstory: "",
    },
    style: "",
    characters: [],
    locations: [],
    voiceExemplars: [],
    chapters: [focusedChapter],
    focusedChapter,
    insertion: {
      beforeText: source,
      afterText: "",
      atChapterEnd: true,
      selectedText: "",
    },
    instructions: "Continue",
    pacing: "auto",
    beatGoal: "",
    approximateLength: 200,
  };
}
