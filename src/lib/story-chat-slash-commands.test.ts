// @ts-expect-error Bun provides this module at test runtime.
import { describe, expect, test } from "bun:test";

import {
  filterStoryChatSlashCommands,
  getStoryChatSlashCommandDraft,
  parseStoryChatSlashCommand,
  STORY_CHAT_SLASH_COMMANDS,
} from "./story-chat-slash-commands";

describe("story chat slash commands", () => {
  test("lists all destination commands in the intended menu order", () => {
    expect(filterStoryChatSlashCommands("").map(({ token }) => token)).toEqual([
      "/instructions",
      "/style",
      "/voice",
      "/character",
      "/location",
    ]);
  });

  test("parses every exact command without arguments", () => {
    for (const command of STORY_CHAT_SLASH_COMMANDS) {
      expect(parseStoryChatSlashCommand(command.token)).toEqual({
        command,
        extraInstructions: "",
        rawContent: command.token,
      });
    }
  });

  test("keeps multiline instructions and original message for new commands", () => {
    for (const token of ["/instructions", "/voice"]) {
      const content = `${token}\n  Keep the latest correction.\nUse restrained dialogue.  \n`;
      const parsed = parseStoryChatSlashCommand(content);

      expect(parsed?.command.token).toBe(token);
      expect(parsed?.extraInstructions).toBe(
        "Keep the latest correction.\nUse restrained dialogue.",
      );
      expect(parsed?.rawContent).toBe(content);
    }
  });

  test("leaves unknown, partial, embedded, and nonexact commands unparsed", () => {
    for (const content of [
      "/unknown Keep this message.",
      "/instruction",
      "/voices",
      "/voiceover",
      "/VOICE",
      "/instructions: explain",
      " /voice",
      "Please use /voice",
      "First line\n/voice",
      "/",
      "",
    ]) {
      expect(parseStoryChatSlashCommand(content)).toBeNull();
    }
  });

  test("filters by command prefix or destination title, ignoring query case", () => {
    expect(
      filterStoryChatSlashCommands("  INS  ").map(({ name }) => name),
    ).toEqual(["instructions"]);
    expect(filterStoryChatSlashCommands("voi").map(({ name }) => name)).toEqual(
      ["voice"],
    );
    expect(
      filterStoryChatSlashCommands("sample").map(({ name }) => name),
    ).toEqual(["voice"]);
    expect(
      filterStoryChatSlashCommands("story").map(({ name }) => name),
    ).toEqual(["instructions"]);
    expect(filterStoryChatSlashCommands("unknown")).toEqual([]);
  });

  test("detects open-menu prefixes separately from commands with arguments", () => {
    expect(getStoryChatSlashCommandDraft("/")).toEqual({
      hasArguments: false,
      query: "",
    });
    expect(getStoryChatSlashCommandDraft("/ins")).toEqual({
      hasArguments: false,
      query: "ins",
    });
    expect(getStoryChatSlashCommandDraft("/voice")).toEqual({
      hasArguments: false,
      query: "voice",
    });
    expect(getStoryChatSlashCommandDraft("/instructions ")).toEqual({
      hasArguments: true,
      query: "instructions",
    });
    expect(
      getStoryChatSlashCommandDraft("/voice\nFirst line\nSecond line"),
    ).toEqual({
      hasArguments: true,
      query: "voice",
    });
    expect(getStoryChatSlashCommandDraft("/unknown")).toEqual({
      hasArguments: false,
      query: "unknown",
    });
    expect(getStoryChatSlashCommandDraft(" /voice")).toBeNull();
    expect(getStoryChatSlashCommandDraft("Discuss /voice")).toBeNull();
  });
});
