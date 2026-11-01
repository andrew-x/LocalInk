import "server-only";

import type { LocalinkAiModelProfile } from "@/lib/ai";
import {
  STUDIO_ASPECTS,
  STUDIO_CRAFT_FIELDS,
  STUDIO_ENTRY_TEMPLATES,
} from "@/lib/studio/bible-templates";
import type {
  StudioPlanItemDto,
  StudioStyle,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import { getInstructionStack } from "@/lib/studio/instructions";
import {
  flattenPlan,
  getOrderedMoments,
  getPlanIndex,
} from "@/lib/studio/plan-order";
import { hashText, tailParagraphs } from "@/lib/studio/prose-text";
import { changesComingOut, computeStateGoingIn } from "@/lib/studio/state";

import {
  budgetPrompt,
  StudioNotFoundError,
  type StudioPromptSection,
  xmlEntryBlock,
  xmlField,
  xmlGroup,
} from "./prompt-kit";

export type StudioMomentAttempt = "first" | "again";

const MOMENT_BASE_OUTPUT_TOKENS = 1_100;
const PREVIOUS_TEXT_PARAGRAPHS = 2;
const MAX_VOICE_SAMPLES = 2;
// Same idea as the story prose route: a fresh alternative needs more
// sampling room to differ from the draft the author just set aside.
const AGAIN_TEMPERATURE_BOOST = 0.13;
const MAX_TEMPERATURE = 1;

const EMPTY_STYLE: StudioStyle = {
  povAndTense: "",
  register: "",
  pacing: "",
  avoid: "",
  notes: "",
};

const STYLE_FIELDS: { key: keyof StudioStyle; tag: string }[] = [
  { key: "povAndTense", tag: "pov_and_tense" },
  { key: "register", tag: "register" },
  { key: "pacing", tag: "pacing" },
  { key: "avoid", tag: "avoid" },
  { key: "notes", tag: "notes" },
];

const SYSTEM_PROMPT = [
  "You write one moment of a longer piece of fiction at a time. The prompt gives you the story's instructions and style, the Bible entries in play, summaries of what came before, the text immediately before this moment, and a brief for this moment.",
  "",
  "Writing contract:",
  "- Write only this moment, in the story's point of view and tense. Do not write the next moment; material marked do-not-write is there only so you can set it up.",
  "- Start exactly where the previous text ends, as a direct continuation. If there is no previous text, begin the moment cleanly.",
  "- Stop when the moment reaches its `endsWith` state (the craft field of that key). If none is given, stop as soon as what happens has happened. Do not close the scene or chapter, fade out, or add a summarizing or reflective kicker.",
  "- Do not name emotions you have already dramatized through action, speech, or perception.",
  '- Fields marked use="steer-only-never-narrate" are background that shapes your choices. Never state them, hint at them as exposition, or narrate them.',
  "- Do not narrate character-sheet traits or backstory as description. Let them show only through what the character does and notices in this moment.",
  "- Match intensity to the stakes of the moment. Small moments stay small.",
  "- Follow the writer's instructions and style. Where they conflict, the more specific instruction wins. They shape voice, not canon: established facts and what each character knows outrank them.",
  "- Aim for roughly 150 to 450 words.",
  "- Output the prose only. No title, heading, notes, preamble, options, or commentary.",
].join("\n");

export function buildStudioMomentSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function getStudioMomentTemperature(
  profile: LocalinkAiModelProfile,
  attempt: StudioMomentAttempt,
): number {
  if (attempt !== "again") return profile.temperature;
  return Math.min(
    profile.temperature + AGAIN_TEMPERATURE_BOOST,
    MAX_TEMPERATURE,
  );
}

function section(
  key: string,
  text: string,
  options: { protected?: boolean; dropOrder?: number } = {},
): StudioPromptSection {
  return {
    key,
    text,
    protected: options.protected ?? true,
    dropOrder: options.dropOrder,
  };
}

function aspectLabel(aspect: string): string {
  return STUDIO_ASPECTS.find((item) => item.key === aspect)?.label ?? aspect;
}

function pickVoiceSamples(
  workspace: StudioWorkspace,
  momentId: string,
  attempt: StudioMomentAttempt,
) {
  const samples = workspace.story.voiceSamples.filter(
    (sample) => sample.text.trim().length > 0,
  );
  if (samples.length === 0) return [];
  const start =
    Number.parseInt(hashText(momentId + attempt), 16) % samples.length;
  const count = Math.min(MAX_VOICE_SAMPLES, samples.length);
  return Array.from(
    { length: count },
    (_, offset) => samples[(start + offset) % samples.length],
  );
}

export function buildStudioMomentPrompt(
  workspace: StudioWorkspace,
  momentId: string,
  globalInstructions: string,
  profile: LocalinkAiModelProfile,
  attempt: StudioMomentAttempt = "first",
): { system: string; prompt: string; maxOutputTokens: number } {
  const moment = workspace.planItems.find((item) => item.id === momentId);
  if (moment?.kind !== "moment") throw new StudioNotFoundError();

  const system = buildStudioMomentSystemPrompt();
  const index = getPlanIndex(workspace.planItems);
  const point = index.get(momentId);
  if (!point) throw new StudioNotFoundError();
  const stateInput = {
    entries: workspace.entries,
    changes: workspace.changes,
    planItems: workspace.planItems,
  };
  const entryNames = new Map(
    workspace.entries.map((entry) => [entry.id, entry.name]),
  );
  const sections: StudioPromptSection[] = [];

  // 1. Instruction stack. Style is its own section, so keep it out of the
  // story layer here.
  const layers = getInstructionStack(
    {
      globalInstructions,
      story: { ...workspace.story, style: EMPTY_STYLE },
      planItems: workspace.planItems,
    },
    momentId,
  );
  sections.push(
    section(
      "instructions",
      xmlGroup(
        "writer_instructions",
        layers.map((layer) =>
          xmlField("instruction", layer.text, { level: layer.level }),
        ),
      ),
    ),
  );

  // 2. Style.
  sections.push(
    section(
      "style",
      xmlGroup(
        "style",
        STYLE_FIELDS.map(({ key, tag }) =>
          xmlField(tag, workspace.story.style[key]),
        ),
      ),
    ),
  );

  // 3. Bible: present and pinned entries, minus excluded, as of this moment.
  const bibleIds = new Set([
    ...moment.presentEntryIds,
    ...moment.contextPinnedEntryIds,
  ]);
  for (const excluded of moment.contextExcludedEntryIds)
    bibleIds.delete(excluded);
  const states = computeStateGoingIn(stateInput, momentId);
  sections.push(
    section(
      "bible",
      xmlGroup(
        "bible",
        workspace.entries
          .filter((entry) => bibleIds.has(entry.id))
          .map((entry) =>
            xmlEntryBlock(
              states.get(entry.id) ?? { entry, aspects: [] },
              STUDIO_ENTRY_TEMPLATES,
            ),
          ),
      ),
    ),
  );

  // 4. Story so far: finished chapters and scenes only. Oldest drop first.
  const earlier = flattenPlan(workspace.planItems).filter((item) => {
    if (item.kind === "moment" || !item.summary.trim()) return false;
    const entry = index.get(item.id);
    return entry !== undefined && entry.endOrder < point.order;
  });
  earlier.forEach((item, position) => {
    sections.push(
      section(
        `story-so-far-${item.id}`,
        xmlField("earlier", item.summary, {
          kind: item.kind,
          title: item.title.trim() || undefined,
        }),
        { protected: false, dropOrder: 10 + position },
      ),
    );
  });

  // 5. Previous written moment's tail.
  const proseByMoment = new Map(
    workspace.prose.map((prose) => [prose.momentId, prose]),
  );
  const moments = getOrderedMoments(workspace.planItems);
  const momentPosition = moments.findIndex((item) => item.id === momentId);
  let previousTail = "";
  for (let i = momentPosition - 1; i >= 0; i--) {
    const markdown = proseByMoment.get(moments[i].id)?.markdown ?? "";
    if (markdown.trim()) {
      previousTail = tailParagraphs(markdown, PREVIOUS_TEXT_PARAGRAPHS);
      break;
    }
  }
  sections.push(
    section("previous-text", xmlField("previous_text", previousTail)),
  );

  // 6. This moment.
  const authorFlag = (field: StudioPlanItemDto["authorFields"][number]) =>
    moment.authorFields.includes(field) ? "true" : undefined;
  const craft = STUDIO_CRAFT_FIELDS.moment.map(({ key, label }) =>
    xmlField("craft", moment.craft[key] ?? "", { key, label }),
  );
  const planned = changesComingOut(stateInput, momentId)
    .filter((change) => entryNames.has(change.entryId))
    .map((change) =>
      xmlField("change", change.value, {
        entry: entryNames.get(change.entryId),
        aspect: aspectLabel(change.aspect),
        about: change.aboutEntryId
          ? entryNames.get(change.aboutEntryId)
          : undefined,
      }),
    );
  sections.push(
    section(
      "this-moment",
      xmlGroup(
        "this_moment",
        [
          xmlField("what_happens", moment.whatHappens, {
            author: authorFlag("whatHappens"),
          }),
          xmlField("how_to_write", moment.howToWrite, {
            author: authorFlag("howToWrite"),
          }),
          ...craft,
          xmlGroup("by_the_end_of_this_moment", planned),
        ],
        { title: moment.title.trim() || undefined },
      ),
    ),
  );

  // 7. Next moment, within the same chapter, as set-up only.
  const next = moments[momentPosition + 1];
  const nextEntry = next ? index.get(next.id) : undefined;
  const sameChapter =
    nextEntry !== undefined &&
    (point.ancestors[0] ?? momentId) === (nextEntry.ancestors[0] ?? next.id);
  if (next && sameChapter) {
    sections.push(
      section(
        "next-moment",
        xmlField("set-up-only", next.whatHappens, { "do-not-write": "true" }),
        { protected: false, dropOrder: 2 },
      ),
    );
  }

  // 8. Voice samples, rotated per moment and attempt.
  const samples = pickVoiceSamples(workspace, momentId, attempt);
  sections.push(
    section(
      "voice-samples",
      xmlGroup(
        "voice_samples",
        samples.map((sample) =>
          xmlField("sample", sample.text, {
            label: sample.label.trim() || undefined,
          }),
        ),
      ),
      { protected: false, dropOrder: 3 },
    ),
  );

  const budgeted = budgetPrompt({
    system,
    sections,
    contextWindowTokens: profile.contextWindowTokens,
    maxOutputTokens: MOMENT_BASE_OUTPUT_TOKENS,
    reasoningAllowance: profile.reasoningOutputTokenAllowance,
  });
  return { system, ...budgeted };
}
