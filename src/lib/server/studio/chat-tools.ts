import "server-only";

import { tool } from "ai";
import { z } from "zod";

import {
  generateLocalinkText,
  isAiConfigurationError,
  LOCALINK_AI_MODEL_PROFILES,
} from "@/lib/ai";
import {
  STUDIO_CRAFT_FIELDS,
  STUDIO_ENTRY_SUGGESTIONS,
  STUDIO_STRUCTURE_TEMPLATES,
} from "@/lib/studio/bible-templates";
import type { StudioChatStep } from "@/lib/studio/chat-contract";
import {
  type StudioEntryType,
  type StudioPlanKind,
  studioChangeModeSchema,
} from "@/lib/studio/contracts";
import { countWords } from "@/lib/studio/prose-text";

import type { StudioBundleBuilder } from "./bundle-builder";
import {
  createStudioChatReadTools,
  type StudioChatToolBudget,
} from "./chat-read-tools";
import {
  buildStudioMomentPrompt,
  getStudioMomentTemperature,
} from "./moment-context";
import {
  StudioContextTooLargeError,
  StudioNotFoundError,
  xmlField,
} from "./prompt-kit";

/**
 * The agent chat's propose and write tools. Every input schema is
 * strict-safe (Ruling R10): an object root, every key required, null for
 * "not given", no records and no length or count bounds. Limits are checked
 * in `execute`, which returns `{ error }` so the model can retry.
 */

const nullableText = z.string().nullable();
// Enums and craft keys come from the Studio constants so the tools cannot
// drift from the data model. Both records are complete by type.
const ENTRY_TYPES = Object.keys(STUDIO_ENTRY_SUGGESTIONS) as StudioEntryType[];
const PLAN_KINDS = Object.keys(STUDIO_CRAFT_FIELDS) as StudioPlanKind[];
const entryTypeSchema = z.enum(ENTRY_TYPES);
const planKindSchema = z.enum(PLAN_KINDS);
const structureTemplateSchema = z.enum(
  STUDIO_STRUCTURE_TEMPLATES.map((template) => template.id),
);
const CRAFT_KEYS_TEXT = PLAN_KINDS.map(
  (kind) =>
    `${kind} ${STUDIO_CRAFT_FIELDS[kind].map((field) => field.key).join(", ")}`,
).join("; ");

const proposeStorySettingsSchema = z.object({
  overview: nullableText,
  instructions: nullableText,
  theme: nullableText,
  structureTemplate: structureTemplateSchema.nullable(),
  structureNotes: nullableText,
  genre: z.array(z.string()).nullable(),
  voice: z
    .object({
      choose: z.array(
        z.object({
          pickId: z.string(),
          optionId: z.string().nullable(),
          custom: z.string().nullable(),
        }),
      ),
      addNotes: z.array(z.string()),
      removeNoteIds: z.array(z.string()),
    })
    .nullable(),
});

const proposeEntriesSchema = z.object({
  items: z.array(
    z.object({
      op: z.enum(["create", "update", "delete"]),
      entryId: nullableText,
      tempId: nullableText,
      type: entryTypeSchema.nullable(),
      customTypeLabel: nullableText,
      name: nullableText,
      summary: nullableText,
      fields: z
        .array(
          z.object({
            action: z.enum(["set", "remove"]),
            label: z.string(),
            value: nullableText,
            steerOnly: z.boolean().nullable(),
            backstoryOnly: z.boolean().nullable(),
          }),
        )
        .nullable(),
      relatedEntryIds: z.array(z.string()).nullable(),
    }),
  ),
});

const proposePlanSchema = z.object({
  items: z.array(
    z.object({
      op: z.enum(["create", "update", "move", "delete"]),
      itemId: nullableText,
      tempId: nullableText,
      kind: planKindSchema.nullable(),
      parentId: nullableText,
      afterId: nullableText,
      newIndex: z.number().nullable(),
      title: nullableText,
      whatHappens: nullableText,
      howToWrite: nullableText,
      craft: z
        .array(z.object({ key: z.string(), value: z.string() }))
        .nullable(),
      presentEntryIds: z.array(z.string()).nullable(),
    }),
  ),
});

const proposeChangesSchema = z.object({
  items: z.array(
    z.object({
      op: z.enum(["create", "update", "delete"]),
      changeId: nullableText,
      entryId: nullableText,
      planItemId: nullableText,
      aspect: nullableText,
      mode: studioChangeModeSchema.nullable(),
      value: nullableText,
      aboutEntryId: nullableText,
    }),
  ),
});

const writeMomentsSchema = z.object({
  momentIds: z.array(z.string()),
  guidance: z.string(),
});

const finalizeBundleSchema = z.object({ summary: z.string() });

const MAX_GUIDANCE_CHARS = 2000;

const STEP_LABELS: Record<string, string> = {
  get_overview: "Reading the story overview",
  get_outline: "Reading the outline",
  get_plan_item: "Reading a plan item",
  get_bible: "Reading the Bible",
  get_entry: "Reading a Bible entry",
  get_state: "Checking story state",
  get_prose: "Reading prose",
  list_flags: "Checking open flags",
  propose_story_settings: "Proposing story settings",
  propose_entries: "Proposing Bible changes",
  propose_plan: "Proposing plan changes",
  propose_changes: "Proposing tracked changes",
  write_moments: "Writing moments",
  finalize_bundle: "Preparing the proposal",
};

/** Static wording only: step labels are stored and shown, never story text. */
export function studioChatStepFor(toolName: string): StudioChatStep {
  return { tool: toolName, label: STEP_LABELS[toolName] ?? "Working" };
}

export function createStudioChatTools({
  storyId,
  builder,
  budget,
  globalInstructions,
  abortSignal,
  onProgress,
}: {
  storyId: string;
  builder: StudioBundleBuilder;
  budget: StudioChatToolBudget;
  globalInstructions: string;
  abortSignal: AbortSignal;
  /** A step when each call starts, and progress inside long calls. */
  onProgress: (step: StudioChatStep) => void;
}) {
  const read = createStudioChatReadTools({ storyId, builder, budget });
  const { charge } = read;

  const writeMoments = async ({
    momentIds,
    guidance,
  }: z.infer<typeof writeMomentsSchema>) => {
    if (guidance.length > MAX_GUIDANCE_CHARS) {
      return {
        error: `guidance must be at most ${MAX_GUIDANCE_CHARS} characters`,
      };
    }
    const plan = builder.planProse(momentIds);
    if ("error" in plan) return plan;
    const profile =
      LOCALINK_AI_MODEL_PROFILES[plan.snapshot.workspace.story.proseModel];
    const results: (
      | { momentId: string; ok: true; words: number }
      | { momentId: string; ok: false; error: string }
    )[] = [];
    try {
      for (const [index, momentRef] of plan.momentRefs.entries()) {
        abortSignal.throwIfAborted();
        onProgress({
          tool: "write_moments",
          label: `Writing moment ${index + 1} of ${plan.momentRefs.length}`,
        });
        let built: ReturnType<typeof buildStudioMomentPrompt>;
        try {
          built = buildStudioMomentPrompt(
            plan.preview,
            momentRef,
            globalInstructions,
            profile,
            "first",
            builder.proseOverlay,
          );
        } catch (error) {
          if (
            !(error instanceof StudioContextTooLargeError) &&
            !(error instanceof StudioNotFoundError)
          ) {
            throw error;
          }
          results.push({
            momentId: momentRef,
            ok: false,
            error:
              error instanceof StudioContextTooLargeError
                ? "The story is too large for the prose model's context."
                : "The moment could not be found.",
          });
          break;
        }
        const request = xmlField("writer_request_for_this_pass", guidance);
        try {
          const result = await generateLocalinkText({
            model: profile.model,
            temperature: getStudioMomentTemperature(profile, "first"),
            system: built.system,
            prompt: request ? `${built.prompt}\n\n${request}` : built.prompt,
            maxOutputTokens: built.maxOutputTokens,
            abortSignal,
          });
          abortSignal.throwIfAborted();
          const markdown = result.text.trim();
          if (result.finishReason !== "stop" || !markdown) {
            results.push({
              momentId: momentRef,
              ok: false,
              error:
                result.finishReason === "length"
                  ? "The prose model hit its output limit before finishing."
                  : "The prose model did not finish this moment.",
            });
            break;
          }
          const added = builder.addProse(plan, momentRef, markdown);
          if ("error" in added) {
            results.push({
              momentId: momentRef,
              ok: false,
              error: added.error,
            });
            break;
          }
          results.push({
            momentId: momentRef,
            ok: true,
            words: countWords(markdown),
          });
        } catch (error) {
          if (abortSignal.aborted) throw error;
          results.push({
            momentId: momentRef,
            ok: false,
            error: isAiConfigurationError(error)
              ? "AI is not configured for this story's prose model."
              : "Prose generation failed for this moment.",
          });
          break;
        }
      }
    } finally {
      // Releases the scene claim; keeps it when prose was proposed.
      builder.endProse();
    }
    const done = new Set(results.map((result) => result.momentId));
    return charge({
      results,
      notAttempted: plan.momentRefs.filter((ref) => !done.has(ref)),
      note: "Written prose is in this turn's proposal for the author to review. You can read it back with get_prose if you need to; later moments in this scene already continue from it. Do not repeat the prose in your reply.",
    });
  };

  const tools = {
    ...read.tools,
    propose_story_settings: tool({
      description:
        "Propose changes to story settings: overview, instructions, theme, structureTemplate, structureNotes, genre (1 to 4 short shelf labels such as YA or Romance; replaces the list), and voice. null leaves a setting unchanged; a given text replaces it entirely. voice changes how the story sounds: choose sets a voice pick (pickId from get_overview, then optionId of one of its options, or custom text of your own with optionId null; both null returns it to the suggested option), addNotes adds short notes about the voice, removeNoteIds removes notes (ids from get_overview). Use empty lists for parts you do not change. Read get_overview first for the current picks and notes.",
      inputSchema: proposeStorySettingsSchema,
      execute: async (input) => charge(builder.proposeStorySettings(input)),
    }),
    propose_entries: tool({
      description: [
        "Propose Bible entry changes. Each item has op create, update, or delete; set unused keys to null.",
        "create: tempId (new:short-name, your choice, reusable as an id later this turn), type, name, summary, fields (action set only), relatedEntryIds (saved or new: ids); customTypeLabel only for type custom.",
        "update: entryId (saved, or a new: id from this turn), then any of name, summary, fields. Field edits are by label: action set adds or replaces a field (value required; steerOnly/backstoryOnly null keeps the field's flags), action remove deletes it. Type, customTypeLabel, and related entries of a saved entry cannot change.",
        "delete: entryId only.",
        "Choose specific, story-relevant field labels; reuse labels other entries of the same type use. At most 40 fields per entry. steerOnly = guides the writing but is never stated; backstoryOnly = never surfaces in present-day scenes.",
      ].join(" "),
      inputSchema: proposeEntriesSchema,
      execute: async ({ items }) => charge(builder.proposeEntries(items)),
    }),
    propose_plan: tool({
      description: [
        "Propose outline changes. Each item has op create, update, move, or delete; set unused keys to null.",
        "create: tempId (new:short-name), kind, parentId (null for a chapter; a chapter for a scene; a scene for a moment; saved or new: ids), afterId (a sibling to follow, or null to append), title, whatHappens, howToWrite, craft, presentEntryIds. List parents before their children.",
        "update: itemId, then any of title, whatHappens, howToWrite, craft (merged by key), presentEntryIds (replaces the list).",
        "move: itemId (saved), parentId, newIndex (0 = first among the new parent's children, counting items this proposal adds).",
        "delete: itemId (saved); removes everything inside it.",
        `Craft keys: ${CRAFT_KEYS_TEXT}.`,
        "Your output per step is limited: for a large plan, send the items in parts of about 25 across several propose_plan calls, waiting for each result before the next; every part joins this turn's proposal.",
      ].join(" "),
      inputSchema: proposePlanSchema,
      execute: async ({ items }) => charge(builder.proposePlan(items)),
    }),
    propose_changes: tool({
      description: [
        "Propose change records: how an entry changes at a point in the story. Each item has op create, update, or delete; set unused keys to null.",
        "create: entryId, planItemId (where the change happens; saved or new: ids), aspect (short free-text label, at most 60 characters), mode (add for things that accumulate such as knowledge, secrets, promises; set for things that replace their previous value), value, aboutEntryId (another entry it concerns, or null).",
        'update: changeId, then any of aspect, mode, value, planItemId, aboutEntryId ("none" clears it).',
        "delete: changeId only.",
        "Reuse an entry's existing aspect labels (get_entry lists them) when the same thing changes; a label keeps the mode it already has.",
      ].join(" "),
      inputSchema: proposeChangesSchema,
      execute: async ({ items }) => charge(builder.proposeChanges(items)),
    }),
    write_moments: tool({
      description:
        'Write prose for moments (saved ids, or new: moments proposed this turn), all in one scene; prose is limited to one scene per turn. Moments are written in story order, each continuing from the one before, using the story\'s prose model, instructions, and voice. guidance is an optional note for this pass ("" for none). Returns word counts; the prose goes into the proposal, and get_prose can read it back.',
      inputSchema: writeMomentsSchema,
      execute: writeMoments,
    }),
    finalize_bundle: tool({
      description:
        "Close this turn's proposal with a one or two sentence summary for the author. Call it once, after your last propose or write call; then briefly describe the proposal and stop.",
      inputSchema: finalizeBundleSchema,
      execute: async ({ summary }) => charge(builder.finalize(summary)),
    }),
  };

  // Each call shows as a step when it starts running, so a long call's own
  // progress (write_moments) always follows its step.
  for (const [name, definition] of Object.entries(tools) as [
    string,
    { execute?: (input: never, options: never) => unknown },
  ][]) {
    const execute = definition.execute;
    if (!execute) continue;
    definition.execute = (input, options) => {
      onProgress(studioChatStepFor(name));
      return execute(input, options);
    };
  }

  return {
    tools,
    schemas: [
      ...read.schemas,
      proposeStorySettingsSchema,
      proposeEntriesSchema,
      proposePlanSchema,
      proposeChangesSchema,
      writeMomentsSchema,
      finalizeBundleSchema,
    ],
  };
}
