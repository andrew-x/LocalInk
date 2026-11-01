import "server-only";

import type { StudioEntryState } from "@/lib/studio/state";

export class StudioContextTooLargeError extends Error {
  constructor(
    message = "This story is too large to send with this model. Try a model with a larger context window.",
  ) {
    super(message);
    this.name = "StudioContextTooLargeError";
  }
}

export class StudioNotFoundError extends Error {
  constructor(message = "This story or moment no longer exists.") {
    super(message);
    this.name = "StudioNotFoundError";
  }
}

/** A request that parses but cannot be served, e.g. a moment asked to flesh out. */
export class StudioBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioBadRequestError";
  }
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderAttributes(
  attributes: Record<string, string | undefined> | undefined,
): string {
  if (!attributes) return "";
  return Object.entries(attributes)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
}

/** An escaped text element. Empty text yields an empty string. */
export function xmlField(
  tag: string,
  text: string,
  attributes?: Record<string, string | undefined>,
): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return `<${tag}${renderAttributes(attributes)}>\n${escapeXml(trimmed)}\n</${tag}>`;
}

export function xmlEmpty(
  tag: string,
  attributes?: Record<string, string | undefined>,
): string {
  return `<${tag}${renderAttributes(attributes)} />`;
}

/** A wrapper around already-rendered child blocks. Empty children yield "". */
export function xmlGroup(
  tag: string,
  children: (string | null | undefined | false)[],
  attributes?: Record<string, string | undefined>,
): string {
  const body = children.filter(Boolean).join("\n");
  if (!body) return "";
  return `<${tag}${renderAttributes(attributes)}>\n${body}\n</${tag}>`;
}

const NEVER_SAYS_USE = "steer-only-never-narrate";

/**
 * One Bible entry with its fields and its state at the point the prompt is
 * about. Fields marked "AI uses, never says" are labeled so the model steers
 * by them without narrating them. Backstory-only fields stay out unless the
 * caller explicitly opts in (planning does; moment prose does not). State
 * lines name the entry they are about; `names` maps entry ids to names.
 */
export function xmlEntryBlock(
  state: StudioEntryState,
  options: {
    includeBackstoryOnly?: boolean;
    names?: ReadonlyMap<string, string>;
  } = {},
): string {
  const { entry } = state;

  // Fields render in the order the Bible holds them; the label is the name.
  const fieldBlocks = entry.fields
    .filter((field) => options.includeBackstoryOnly || !field.backstoryOnly)
    .map((field) =>
      xmlField("field", field.value, {
        label: field.label,
        author: field.author === "author" ? "true" : undefined,
        use: field.steerOnly ? NEVER_SAYS_USE : undefined,
      }),
    )
    .filter(Boolean);

  const stateBlocks = state.aspects
    .map((aspect) =>
      xmlField("state", aspect.values.map((item) => item.value).join("\n"), {
        aspect: aspect.aspect,
        about: aspect.aboutEntryId
          ? (options.names?.get(aspect.aboutEntryId) ?? aspect.aboutEntryId)
          : undefined,
      }),
    )
    .filter(Boolean);

  const type =
    entry.type === "custom" && entry.customTypeLabel.trim()
      ? entry.customTypeLabel.trim()
      : entry.type;
  return (
    xmlGroup(
      "entry",
      [
        xmlField("summary", entry.summary),
        ...fieldBlocks,
        stateBlocks.length > 0
          ? xmlGroup("state_at_this_point", stateBlocks)
          : null,
      ],
      {
        id: entry.id,
        type,
        name: entry.name,
        related:
          entry.relatedEntryIds.length > 0
            ? entry.relatedEntryIds.join(",")
            : undefined,
      },
    ) ||
    `<entry id="${escapeXml(entry.id)}" type="${escapeXml(type)}" name="${escapeXml(entry.name)}" />`
  );
}

export type StudioPromptSection = {
  key: string;
  text: string;
  /** Protected sections are never dropped. */
  protected: boolean;
  /** Lower values are dropped first. Unset drops last among unprotected. */
  dropOrder?: number;
};

// Tokens are estimated from UTF-8 bytes. Three bytes per token is
// conservative for English prose and for the JSON-heavy prompts used here.
const BYTES_PER_TOKEN = 3;
const encoder = new TextEncoder();

export function estimateStudioTokens(text: string): number {
  return Math.ceil(encoder.encode(text).byteLength / BYTES_PER_TOKEN);
}

/**
 * Joins sections in their given order, dropping unprotected sections in
 * ascending `dropOrder` until the prompt, the system prompt, and the output
 * allowance fit the context window. Never truncates a section's text.
 */
export function budgetPrompt({
  system,
  sections,
  contextWindowTokens,
  maxOutputTokens,
  reasoningAllowance,
}: {
  system: string;
  sections: StudioPromptSection[];
  contextWindowTokens: number;
  maxOutputTokens: number;
  reasoningAllowance: number;
}): { prompt: string; maxOutputTokens: number } {
  const outputTokens = maxOutputTokens + reasoningAllowance;
  const kept = sections.filter((section) => section.text.trim().length > 0);
  const dropQueue = kept
    .map((section, index) => ({ section, index }))
    .filter(({ section }) => !section.protected)
    .sort(
      (a, b) =>
        (a.section.dropOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.section.dropOrder ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    );
  const dropped = new Set<StudioPromptSection>();

  const build = () =>
    kept
      .filter((section) => !dropped.has(section))
      .map((section) => section.text)
      .join("\n\n");
  const fits = (prompt: string) =>
    estimateStudioTokens(system) +
      estimateStudioTokens(prompt) +
      outputTokens <=
    contextWindowTokens;

  let prompt = build();
  while (!fits(prompt)) {
    const next = dropQueue.shift();
    if (!next) throw new StudioContextTooLargeError();
    dropped.add(next.section);
    prompt = build();
  }
  return { prompt, maxOutputTokens: outputTokens };
}
