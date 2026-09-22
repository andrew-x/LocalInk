export const STORY_CHAT_SLASH_COMMANDS = [
  {
    description: "Turn agreed story rules into copy-ready instructions",
    name: "instructions",
    title: "Story instructions",
    token: "/instructions",
  },
  {
    description: "Turn agreed prose choices into a copy-ready style guide",
    name: "style",
    title: "Style Guide",
    token: "/style",
  },
  {
    description: "Write a copy-ready passage in the agreed voice",
    name: "voice",
    title: "Voice sample",
    token: "/voice",
  },
  {
    description: "Turn agreed character details into a copy-ready description",
    name: "character",
    title: "Character",
    token: "/character",
  },
  {
    description: "Turn agreed location details into a copy-ready description",
    name: "location",
    title: "Location",
    token: "/location",
  },
] as const;

export type StoryChatSlashCommandMetadata =
  (typeof STORY_CHAT_SLASH_COMMANDS)[number];

export type StoryChatSlashCommandName = StoryChatSlashCommandMetadata["name"];

export type ParsedStoryChatSlashCommand = {
  command: StoryChatSlashCommandMetadata;
  extraInstructions: string;
  rawContent: string;
};

export type StoryChatSlashCommandDraft = {
  hasArguments: boolean;
  query: string;
};

export function parseStoryChatSlashCommand(
  content: string,
): ParsedStoryChatSlashCommand | null {
  const match = content.trimEnd().match(/^(\/[^\s]+)(?:\s+([\s\S]*))?$/);

  if (!match) {
    return null;
  }

  const command = STORY_CHAT_SLASH_COMMANDS.find(
    (slashCommand) => slashCommand.token === match[1],
  );

  if (!command) {
    return null;
  }

  return {
    command,
    extraInstructions: match[2]?.trim() ?? "",
    rawContent: content,
  };
}

export function getStoryChatSlashCommandDraft(
  content: string,
): StoryChatSlashCommandDraft | null {
  if (!content.startsWith("/")) {
    return null;
  }

  const match = content.match(/^\/([^\s]*)(\s[\s\S]*)?$/);

  if (!match) {
    return null;
  }

  return {
    hasArguments: Boolean(match[2]),
    query: match[1] ?? "",
  };
}

export function filterStoryChatSlashCommands(
  query: string,
): StoryChatSlashCommandMetadata[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [...STORY_CHAT_SLASH_COMMANDS];
  }

  return STORY_CHAT_SLASH_COMMANDS.filter((command) => {
    return (
      command.name.startsWith(normalizedQuery) ||
      command.title.toLowerCase().includes(normalizedQuery)
    );
  });
}
