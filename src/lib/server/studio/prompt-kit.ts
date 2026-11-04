import "server-only";

import {
  entryAspectLabels,
  modeForLabel,
  unusedAspectSuggestions,
} from "@/lib/studio/aspects";
import type {
  StudioChangeDto,
  StudioEntryDto,
  StudioPlanItemDto,
} from "@/lib/studio/contracts";
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

/** A staged draft this request builds on is gone (expired or server restart). */
export class StudioDraftExpiredError extends Error {
  constructor() {
    super("An earlier part of this draft is no longer available.");
    this.name = "StudioDraftExpiredError";
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

/**
 * Rules for choosing a change's aspect label and mode. Shared by planning and
 * read-back so both reuse labels the story already tracks.
 */
export const ASPECT_GUIDANCE =
  "An aspect is a short free-text label for what is changing (for example Trusts Mara, Believes the letter was burned). Reuse a label from tracked_aspects when the same thing changes; invent a short, specific label only for something new. mode is add for things that accumulate (knowledge, secrets, promises) and set for anything that replaces its previous value. Keep the same mode every time a label is used.";

/** Examples of labels and modes. They are ideas, not a required set. */
export function aspectExamplesBlock(changes: StudioChangeDto[]): string {
  const used = changes.map((change) => change.aspect);
  return xmlGroup(
    "aspect_examples",
    unusedAspectSuggestions(used).map((suggestion) =>
      xmlField("example", suggestion.hint, {
        label: suggestion.label,
        mode: suggestion.mode,
      }),
    ),
  );
}

/** The aspect labels each listed entry already tracks, with their modes. */
export function trackedAspectsBlock(
  entries: StudioEntryDto[],
  changes: StudioChangeDto[],
  planItems: StudioPlanItemDto[],
): string {
  return xmlGroup(
    "tracked_aspects",
    entries.map((entry) => {
      const labels = entryAspectLabels(changes, entry.id, planItems);
      return xmlGroup(
        "entry",
        labels.map((label) =>
          xmlEmpty("aspect", {
            label,
            mode:
              modeForLabel(changes, entry.id, label, planItems) ?? undefined,
          }),
        ),
        { id: entry.id, name: entry.name },
      );
    }),
  );
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
        mode: aspect.mode,
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
        xmlField("in_the_authors_words", entry.summary),
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
