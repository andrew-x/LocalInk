import "server-only";

import { tool } from "ai";
import { z } from "zod";

import { entryAspectLabels, modeForLabel } from "@/lib/studio/aspects";
import {
  STUDIO_CRAFT_FIELDS,
  STUDIO_ENTRY_SUGGESTIONS,
  STUDIO_STRUCTURE_TEMPLATES,
} from "@/lib/studio/bible-templates";
import type {
  StudioEntryDto,
  StudioPlanItemDto,
  StudioWorkspace,
} from "@/lib/studio/contracts";
import {
  buildPlanTree,
  flattenPlan,
  getAncestors,
  getOrderedMoments,
  getPlanIndex,
  type StudioPlanNode,
  sortChangesForReplay,
} from "@/lib/studio/plan-order";
import { countWords } from "@/lib/studio/prose-text";
import { computeStateGoingIn } from "@/lib/studio/state";

import type { StudioBundleBuilder } from "./bundle-builder";
import { clip } from "./bundle-draft";
import { StudioNotFoundError } from "./prompt-kit";
import { loadStudioWorkspace } from "./repository";

/**
 * The agent chat's read tools. They read the saved story each time they
 * run, so the author's edits during a turn are seen. Proposed prose from
 * this turn is overlaid in get_prose and marked in get_outline; other
 * proposed changes are not reflected in reads. Inputs are strict-safe.
 */

/** Bytes left for tool results before the next model call is over budget. */
export type StudioChatToolBudget = { remaining: number };

const MAX_PROSE_CHARS = 24_000;
const BUILT_IN_TYPES = Object.keys(STUDIO_ENTRY_SUGGESTIONS).filter(
  (type) => type !== "custom",
);
const BRIEF_CHARS = 200;
const SUMMARY_CHARS = 300;

const emptySchema = z.object({});
const itemIdSchema = z.object({ itemId: z.string() });
const bibleSchema = z.object({ type: z.string().nullable() });
const entryIdSchema = z.object({ entryId: z.string() });
const proseSchema = z.object({ momentIds: z.array(z.string()) });

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function typeName(entry: StudioEntryDto): string {
  return entry.type === "custom"
    ? entry.customTypeLabel.trim() || "custom"
    : entry.type;
}

export function createStudioChatReadTools({
  storyId,
  builder,
  budget,
}: {
  storyId: string;
  builder: StudioBundleBuilder;
  budget: StudioChatToolBudget;
}) {
  /** Read results that would not fit are refused with `{ error }`. */
  const within = <T>(result: T): T | { error: string } => {
    const bytes = byteSize(result) + 1024;
    if (bytes > budget.remaining) {
      return {
        error:
          "The remaining context budget cannot hold this result. Ask for less (fewer moments, one item) or finish your reply with what you have.",
      };
    }
    budget.remaining -= bytes;
    return result;
  };

  /**
   * Results of work already done (a proposal was added, prose written) are
   * never refused, or the model would retry work that happened; they only
   * use up budget.
   */
  const charge = <T>(result: T): T => {
    budget.remaining -= byteSize(result) + 1024;
    return result;
  };

  const load = (): StudioWorkspace => {
    const workspace = loadStudioWorkspace(storyId);
    if (!workspace) throw new StudioNotFoundError();
    return workspace;
  };

  const writtenIds = (workspace: StudioWorkspace) =>
    new Set(
      workspace.prose
        .filter((prose) => prose.markdown.trim())
        .map((prose) => prose.momentId),
    );

  /**
   * Status text per plan item for one read: moments say whether they are
   * written; chapters and scenes count written moments inside them.
   */
  const statusReader = (workspace: StudioWorkspace) => {
    const written = writtenIds(workspace);
    const proposed = builder.proseOverlay;
    const index = getPlanIndex(workspace.planItems);
    const ordered = getOrderedMoments(workspace.planItems).map((moment) => ({
      moment,
      order: index.get(moment.id)?.order ?? -1,
    }));
    const momentsInside = (itemId: string) => {
      const point = index.get(itemId);
      if (!point) return [];
      return ordered
        .filter(({ order }) => order > point.order && order <= point.endOrder)
        .map(({ moment }) => moment);
    };
    const statusOf = (node: StudioPlanItemDto): string => {
      if (node.kind === "moment") {
        if (proposed.has(node.id)) return "prose proposed this turn";
        return written.has(node.id) ? "written" : "unwritten";
      }
      const moments = momentsInside(node.id);
      const done = moments.filter((moment) => written.has(moment.id)).length;
      return `${done} of ${moments.length} moments written`;
    };
    return { written, proposed, momentsInside, statusOf };
  };

  const tools = {
    get_overview: tool({
      description:
        "Read the story's overview, theme, story instructions (the writer's own words), genre, voice picks and notes, kinds of moments, structure, and counts.",
      inputSchema: emptySchema,
      execute: async () => {
        const workspace = load();
        const { story } = workspace;
        const template = STUDIO_STRUCTURE_TEMPLATES.find(
          (item) => item.id === story.structureTemplate,
        );
        const written = writtenIds(workspace);
        const kinds = (kind: StudioPlanItemDto["kind"]) =>
          workspace.planItems.filter((item) => item.kind === kind).length;
        return within({
          title: story.title,
          overview: story.overview,
          theme: story.theme,
          instructions: story.instructions,
          genre: story.genre,
          picks: story.voice.picks.map((pick) => ({
            id: pick.id,
            label: pick.label,
            question: pick.question,
            options: pick.options.map((option) => ({
              id: option.id,
              label: option.label,
            })),
            suggestedOptionId: pick.suggestedOptionId,
            chosenOptionId: pick.chosenOptionId,
            custom: pick.custom,
          })),
          notes: story.voice.notes.map((note) => ({
            id: note.id,
            text: note.text,
          })),
          momentKinds: story.voice.moments.map((moment) => moment.kind),
          structure: {
            template: story.structureTemplate,
            label: template?.label ?? story.structureTemplate,
            guidance: template?.guidance ?? "",
            notes: story.structureNotes,
          },
          counts: {
            entries: workspace.entries.length,
            chapters: kinds("chapter"),
            scenes: kinds("scene"),
            moments: kinds("moment"),
            writtenMoments: written.size,
            openFlags: workspace.flags.filter((flag) => flag.status === "open")
              .length,
            pendingProposals: workspace.bundles.filter(
              (bundle) => bundle.status === "pending",
            ).length,
          },
        });
      },
    }),
    get_outline: tool({
      description:
        "Read the whole outline as a tree of chapters, scenes, and moments: id, kind, title, the start of whatHappens, and status (written or not).",
      inputSchema: emptySchema,
      execute: async () => {
        const workspace = load();
        const { statusOf } = statusReader(workspace);
        type OutlineNode = {
          id: string;
          kind: string;
          title: string;
          whatHappens: string;
          status: string;
          children?: OutlineNode[];
        };
        const toNode = (node: StudioPlanNode): OutlineNode => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          whatHappens: clip(node.whatHappens, BRIEF_CHARS),
          status: statusOf(node),
          ...(node.children.length > 0
            ? { children: node.children.map(toNode) }
            : {}),
        });
        return within({
          chapters: buildPlanTree(workspace.planItems).map(toNode),
        });
      },
    }),
    get_plan_item: tool({
      description:
        "Read one chapter, scene, or moment in full: brief, craft, present entries, the change records pinned to it, its children, and (for chapters and scenes) the ids of every moment inside it.",
      inputSchema: itemIdSchema,
      execute: async ({ itemId }) => {
        const workspace = load();
        const item = workspace.planItems.find(
          (candidate) => candidate.id === itemId.trim(),
        );
        if (!item) {
          return {
            error: `There is no plan item with id ${itemId}. Use get_outline for ids.`,
          };
        }
        const names = new Map(
          workspace.entries.map((entry) => [entry.id, entry.name]),
        );
        const { written, proposed, momentsInside, statusOf } =
          statusReader(workspace);
        const children = workspace.planItems
          .filter((child) => child.parentId === item.id)
          .sort((a, b) => a.position - b.position);
        const moments =
          item.kind === "moment"
            ? undefined
            : momentsInside(item.id).map((moment) => ({
                id: moment.id,
                title: moment.title,
                sceneId: moment.parentId,
                status: statusOf(moment),
              }));
        const prose = workspace.prose.find((row) => row.momentId === item.id);
        return within({
          item: {
            id: item.id,
            kind: item.kind,
            parentId: item.parentId,
            title: item.title,
            whatHappens: item.whatHappens,
            howToWrite: item.howToWrite,
            craft: STUDIO_CRAFT_FIELDS[item.kind]
              .map(({ key, label }) => ({
                key,
                label,
                value: item.craft[key] ?? "",
              }))
              .filter((field) => field.value.trim()),
            presentEntries: item.presentEntryIds.map((id) => ({
              id,
              name: names.get(id) ?? id,
            })),
            summary: item.summary,
            authorWrittenFields: item.authorFields,
          },
          ancestors: getAncestors(workspace.planItems, item.id).map(
            (ancestor) => ({
              id: ancestor.id,
              kind: ancestor.kind,
              title: ancestor.title,
            }),
          ),
          children: children.map((child) => ({
            id: child.id,
            kind: child.kind,
            title: child.title,
            whatHappens: clip(child.whatHappens, BRIEF_CHARS),
            status: statusOf(child),
          })),
          ...(moments ? { moments } : {}),
          changes: workspace.changes
            .filter((change) => change.planItemId === item.id)
            .sort((a, b) => a.position - b.position)
            .map((change) => ({
              id: change.id,
              entryId: change.entryId,
              entry: names.get(change.entryId) ?? change.entryId,
              aspect: change.aspect,
              mode: change.mode,
              value: change.value,
              aboutEntryId: change.aboutEntryId,
              status: change.status,
              authorEdited: change.authorEdited,
            })),
          ...(item.kind === "moment"
            ? {
                prose: {
                  written: written.has(item.id),
                  words: prose?.wordCount ?? 0,
                  proposedThisTurn: proposed.has(item.id),
                },
              }
            : {}),
          openFlags: workspace.flags.filter(
            (flag) => flag.planItemId === item.id && flag.status === "open",
          ).length,
        });
      },
    }),
    get_bible: tool({
      description: `List Bible entries: id, type, name, the start of the summary, and field labels. type filters by entry type (${BUILT_IN_TYPES.join(", ")}, or a custom type label); null lists all.`,
      inputSchema: bibleSchema,
      execute: async ({ type }) => {
        const workspace = load();
        const wanted = type?.trim().toLowerCase() || null;
        const entries = workspace.entries.filter(
          (entry) =>
            wanted === null ||
            entry.type === wanted ||
            typeName(entry).toLowerCase() === wanted,
        );
        return within({
          entries: entries.map((entry) => ({
            id: entry.id,
            type: typeName(entry),
            name: entry.name,
            summary: clip(entry.summary, SUMMARY_CHARS),
            fieldLabels: entry.fields.map((field) => field.label),
          })),
          ...(entries.length === 0 && wanted !== null
            ? {
                note: `No entries of that type. Types in use: ${
                  [...new Set(workspace.entries.map(typeName))].join(", ") ||
                  "none"
                }.`,
              }
            : {}),
        });
      },
    }),
    get_entry: tool({
      description:
        "Read one Bible entry in full: fields (with who wrote them and their steerOnly/backstoryOnly flags), related entries, the aspect labels it already tracks, and its change records in story order.",
      inputSchema: entryIdSchema,
      execute: async ({ entryId }) => {
        const workspace = load();
        const entry = workspace.entries.find(
          (candidate) => candidate.id === entryId.trim(),
        );
        if (!entry) {
          return {
            error: `There is no entry with id ${entryId}. Use get_bible for ids.`,
          };
        }
        const names = new Map(
          workspace.entries.map((item) => [item.id, item.name]),
        );
        const items = new Map(
          workspace.planItems.map((item) => [item.id, item]),
        );
        const index = getPlanIndex(workspace.planItems);
        const own = sortChangesForReplay(
          workspace.changes.filter((change) => change.entryId === entry.id),
          index,
        );
        return within({
          entry: {
            id: entry.id,
            type: typeName(entry),
            name: entry.name,
            summary: entry.summary,
            fields: entry.fields.map((field) => ({
              label: field.label,
              value: field.value,
              writtenBy: field.author,
              steerOnly: field.steerOnly,
              backstoryOnly: field.backstoryOnly,
            })),
            related: entry.relatedEntryIds.map((id) => ({
              id,
              name: names.get(id) ?? id,
            })),
          },
          trackedAspects: entryAspectLabels(
            workspace.changes,
            entry.id,
            workspace.planItems,
          ).map((label) => ({
            label,
            mode: modeForLabel(
              workspace.changes,
              entry.id,
              label,
              workspace.planItems,
            ),
          })),
          changes: own.map((change) => {
            const item = items.get(change.planItemId);
            return {
              id: change.id,
              planItemId: change.planItemId,
              planItem: item ? `${item.kind} ${item.title}`.trim() : "",
              aspect: change.aspect,
              mode: change.mode,
              value: change.value,
              aboutEntryId: change.aboutEntryId,
              about: change.aboutEntryId
                ? (names.get(change.aboutEntryId) ?? null)
                : null,
              status: change.status,
              authorEdited: change.authorEdited,
            };
          }),
        });
      },
    }),
    get_state: tool({
      description:
        "Story state going into a plan item: for each entry present there (or inside it), the value of every tracked aspect from changes pinned to items that end before it starts.",
      inputSchema: itemIdSchema,
      execute: async ({ itemId }) => {
        const workspace = load();
        const item = workspace.planItems.find(
          (candidate) => candidate.id === itemId.trim(),
        );
        if (!item) {
          return {
            error: `There is no plan item with id ${itemId}. Use get_outline for ids.`,
          };
        }
        let ids = item.presentEntryIds;
        if (ids.length === 0) {
          const inside = new Set<string>();
          const index = getPlanIndex(workspace.planItems);
          const point = index.get(item.id);
          for (const other of flattenPlan(workspace.planItems)) {
            const entry = index.get(other.id);
            if (
              point &&
              entry &&
              entry.order > point.order &&
              entry.order <= point.endOrder
            ) {
              for (const id of other.presentEntryIds) inside.add(id);
            }
          }
          ids = [...inside];
        }
        const names = new Map(
          workspace.entries.map((entry) => [entry.id, entry.name]),
        );
        const states = computeStateGoingIn(
          {
            entries: workspace.entries,
            changes: workspace.changes,
            planItems: workspace.planItems,
          },
          item.id,
        );
        return within({
          itemId: item.id,
          entries: ids.flatMap((id) => {
            const state = states.get(id);
            if (!state) return [];
            return [
              {
                id,
                name: state.entry.name,
                aspects: state.aspects.map((aspect) => ({
                  aspect: aspect.aspect,
                  mode: aspect.mode,
                  about: aspect.aboutEntryId
                    ? (names.get(aspect.aboutEntryId) ?? aspect.aboutEntryId)
                    : null,
                  values: aspect.values.map((value) => value.value),
                })),
              },
            ];
          }),
          ...(ids.length === 0
            ? { note: "No entries are marked present at or inside this item." }
            : {}),
        });
      },
    }),
    get_prose: tool({
      description: `Read the prose of moments by moment id (get moment ids from get_outline or get_plan_item). Prose proposed this turn replaces the saved text and is marked. At most ${MAX_PROSE_CHARS.toLocaleString("en-US")} characters per call; moments that do not fit are listed in notIncluded.`,
      inputSchema: proseSchema,
      execute: async ({ momentIds }) => {
        const workspace = load();
        const proposed = builder.proseOverlay;
        const ids = [
          ...new Set(momentIds.map((id) => id.trim()).filter(Boolean)),
        ];
        if (ids.length === 0) return { error: "momentIds is empty" };
        const items = new Map(
          workspace.planItems.map((item) => [item.id, item]),
        );
        const bad = ids.filter(
          (id) => items.get(id)?.kind !== "moment" && !proposed.has(id),
        );
        if (bad.length > 0) {
          return {
            error: `These are not moment ids: ${bad.join(", ")}. Use get_outline or get_plan_item to find moment ids.`,
          };
        }
        const order = new Map(
          getOrderedMoments(workspace.planItems).map((item, position) => [
            item.id,
            position,
          ]),
        );
        ids.sort(
          (a, b) =>
            (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b) ?? Number.MAX_SAFE_INTEGER),
        );
        const saved = new Map(
          workspace.prose.map((prose) => [prose.momentId, prose.markdown]),
        );
        let left = MAX_PROSE_CHARS;
        const moments: {
          id: string;
          title: string;
          proposedThisTurn: boolean;
          words: number;
          markdown: string;
          clippedFromChars?: number;
        }[] = [];
        const notIncluded: string[] = [];
        for (const id of ids) {
          const markdown = proposed.get(id) ?? saved.get(id) ?? "";
          const base = {
            id,
            title: items.get(id)?.title ?? "",
            proposedThisTurn: proposed.has(id),
            words: countWords(markdown),
          };
          if (markdown.length <= left) {
            moments.push({ ...base, markdown });
            left -= markdown.length;
          } else if (moments.length === 0) {
            // One moment longer than the cap: say so instead of hiding it.
            moments.push({
              ...base,
              markdown: markdown.slice(0, left),
              clippedFromChars: markdown.length,
            });
            left = 0;
          } else {
            notIncluded.push(id);
          }
        }
        return within({
          moments,
          ...(notIncluded.length > 0
            ? {
                notIncluded,
                note: "These did not fit in one call; ask for them separately.",
              }
            : {}),
        });
      },
    }),
    list_flags: tool({
      description:
        "List open read-back flags: changes the prose shows that were not planned, and planned changes the prose does not show.",
      inputSchema: emptySchema,
      execute: async () => {
        const workspace = load();
        const names = new Map(
          workspace.entries.map((entry) => [entry.id, entry.name]),
        );
        const items = new Map(
          workspace.planItems.map((item) => [item.id, item]),
        );
        const changes = new Map(
          workspace.changes.map((change) => [change.id, change]),
        );
        return within({
          flags: workspace.flags
            .filter((flag) => flag.status === "open")
            .map((flag) => {
              const item = items.get(flag.planItemId);
              const base = {
                id: flag.id,
                planItemId: flag.planItemId,
                planItem: item ? `${item.kind} ${item.title}`.trim() : "",
                kind: flag.kind,
              };
              if (flag.payload.kind === "unplanned-change") {
                return {
                  ...base,
                  entryId: flag.payload.entryId,
                  entry:
                    names.get(flag.payload.entryId) ?? flag.payload.entryId,
                  aspect: flag.payload.aspect,
                  mode: flag.payload.mode,
                  value: flag.payload.value,
                  about: flag.payload.aboutEntryId
                    ? (names.get(flag.payload.aboutEntryId) ?? null)
                    : null,
                };
              }
              const change = changes.get(flag.payload.changeId);
              return {
                ...base,
                changeId: flag.payload.changeId,
                ...(change
                  ? {
                      entry: names.get(change.entryId) ?? change.entryId,
                      aspect: change.aspect,
                      value: change.value,
                    }
                  : {}),
              };
            }),
        });
      },
    }),
  };

  return {
    tools,
    schemas: [
      emptySchema,
      itemIdSchema,
      bibleSchema,
      entryIdSchema,
      proseSchema,
    ],
    within,
    charge,
  };
}
