import "server-only";

import { ActionError } from "@/lib/action-error";
import day from "@/lib/dayjs";
import {
  STUDIO_BUNDLE_MAX_OPS,
  type StudioBundleOp,
  type StudioBundleOpInput,
  type StudioBundleSelectionIssue,
  studioBundleOpsInputSchema,
  validateStudioBundleOps,
} from "@/lib/studio/bundle-contract";
import type { StudioWorkspace } from "@/lib/studio/contracts";
import { getOrderedMoments } from "@/lib/studio/plan-order";
import { hashText } from "@/lib/studio/prose-text";

import { type ChangeItemInput, proposeChanges } from "./bundle-builder-changes";
import {
  type EntryItemInput,
  proposeEntries,
  proposeStorySettings,
  type StorySettingsInput,
} from "./bundle-builder-ops";
import { type PlanItemInput, proposePlan } from "./bundle-builder-plan";
import {
  BuilderDraft,
  type BuilderSnapshot,
  type BuilderState,
  emptyBuilderState,
  loadBuilderSnapshot,
  type OpOf,
  quoted,
} from "./bundle-draft";
import { findBundleSelectionIssues } from "./bundle-precheck";
import { previewStudioWorkspace } from "./bundle-preview";

export type {
  ChangeItemInput,
  EntryItemInput,
  PlanItemInput,
  StorySettingsInput,
};

export const STUDIO_CHAT_FALLBACK_SUMMARY = "Proposed changes";
export const STUDIO_CHAT_MAX_MOMENTS_PER_CALL = 12;
const MAX_SUMMARY_CHARS = 2000;
const MAX_PROSE_CHARS = 200_000;

export type BuilderOutcome = { error: string } | Record<string, unknown>;

export type StudioChatBundleCandidate = {
  summary: string;
  operations: StudioBundleOpInput[];
};

export type ProsePlan = {
  snapshot: BuilderSnapshot;
  preview: StudioWorkspace;
  sceneRef: string;
  /** Moment refs in story order. */
  momentRefs: string[];
};

const ISSUE_TEXT: Record<StudioBundleSelectionIssue["kind"], string> = {
  "missing-dependency": "depends on something no other proposed change creates",
  conflict: "no longer matches the saved story",
  "too-many-fields": "would leave an entry with too many fields",
  invalid: "cannot be applied as proposed (wrong kind of parent or item)",
};

const GROUP_ORDER: Record<StudioBundleOpInput["kind"], number> = {
  "story.update": 0,
  "entry.create": 1,
  "entry.update": 1,
  "entry.delete": 1,
  "plan.create": 2,
  "plan.update": 2,
  "plan.move": 2,
  "plan.delete": 2,
  "change.create": 3,
  "change.update": 3,
  "change.delete": 3,
  "prose.write": 4,
};

/**
 * Checks the whole candidate the way insert and accept will. Problems with
 * ops this call touched are errors (the call is rejected). A conflict on an
 * op whose baseline was read in an earlier call (including one this call
 * merged into) means the author edited that record during the turn; only
 * the author can resolve that, so it is a note, and accept will flag it.
 */
function checkCandidate(
  ops: StudioBundleOpInput[],
  snapshot: BuilderSnapshot,
  { touched, created }: { touched: Set<string>; created: Set<string> },
): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  if (ops.length > STUDIO_BUNDLE_MAX_OPS) {
    errors.push(
      `a proposal holds at most ${STUDIO_BUNDLE_MAX_OPS} changes; this would make ${ops.length}`,
    );
    return { errors, notes };
  }
  const parsed = studioBundleOpsInputSchema.safeParse(ops);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 5)) {
      const op = ops[Number(issue.path[0])];
      errors.push(
        `“${op?.label ?? "a change"}” is not valid (${issue.path.slice(1).map(String).join(".") || "op"}: ${issue.message})`,
      );
    }
    return { errors, notes };
  }
  errors.push(...validateStudioBundleOps(ops));
  const stored = ops.map(
    (op): StudioBundleOp => ({ ...op, status: "pending" }),
  );
  const issues = findBundleSelectionIssues(
    stored,
    new Set(ops.map((op) => op.id)),
    snapshot.rows,
    day().toISOString(),
  );
  for (const issue of issues) {
    const text = `“${issue.label}” ${ISSUE_TEXT[issue.kind]}`;
    if (issue.kind === "conflict" && !created.has(issue.opId)) {
      notes.push(
        `${text}: the author changed it during this turn, so it will show as a conflict for them to deselect.`,
      );
    } else if (issue.kind === "conflict" || touched.has(issue.opId)) {
      errors.push(text);
    } else {
      notes.push(`${text}; accept will refuse it unless it is deselected.`);
    }
  }
  return { errors, notes };
}

/**
 * Accumulates the agent chat's proposed ops for one turn. Baselines come
 * from the saved story at the moment each op is first proposed; nothing is
 * written. Each propose call is all-or-nothing and reports problems as
 * `{ error }` so the model can retry. Accept stays the authority: it checks
 * everything again against the story at that time.
 */
export class StudioBundleBuilder {
  private state: BuilderState = emptyBuilderState();

  constructor(private readonly storyId: string) {}

  get opCount(): number {
    return this.state.ops.length;
  }

  get isFinalized(): boolean {
    return this.state.finalizedSummary !== null;
  }

  /** Proposed prose by moment ref, newest write per moment. */
  get proseOverlay(): Map<string, string> {
    return new Map(
      this.state.ops
        .filter((op): op is OpOf<"prose.write"> => op.kind === "prose.write")
        .map((op) => [op.momentRef, op.markdown]),
    );
  }

  /** The candidate to stage, or null when nothing was proposed. */
  build(): StudioChatBundleCandidate | null {
    if (this.state.ops.length === 0) return null;
    const operations = this.state.ops
      .map((op, index) => ({ op, index }))
      .sort(
        (a, b) =>
          GROUP_ORDER[a.op.kind] - GROUP_ORDER[b.op.kind] || a.index - b.index,
      )
      .map(({ op }) => op);
    return {
      summary: this.state.finalizedSummary ?? STUDIO_CHAT_FALLBACK_SUMMARY,
      operations: structuredClone(operations),
    };
  }

  proposeStorySettings(input: StorySettingsInput): BuilderOutcome {
    return this.run((draft) => proposeStorySettings(draft, input));
  }

  proposeEntries(items: EntryItemInput[]): BuilderOutcome {
    return this.run((draft) => proposeEntries(draft, items));
  }

  proposePlan(items: PlanItemInput[]): BuilderOutcome {
    return this.run((draft) => proposePlan(draft, items));
  }

  proposeChanges(items: ChangeItemInput[]): BuilderOutcome {
    return this.run((draft) => proposeChanges(draft, items));
  }

  finalize(summary: string): BuilderOutcome {
    if (this.isFinalized) {
      return {
        error:
          "finalize_bundle was already called this turn. Describe the proposal to the author and finish your reply.",
      };
    }
    const text = summary.trim().replace(/\s+/g, " ");
    if (!text || text.length > MAX_SUMMARY_CHARS) {
      return {
        error: `summary must be 1 to ${MAX_SUMMARY_CHARS} characters`,
      };
    }
    if (this.state.ops.length === 0) {
      return {
        error:
          "There is nothing to finalize: no changes were proposed this turn. If you are only discussing, reply without a proposal.",
      };
    }
    const snapshot = this.snapshot();
    if ("error" in snapshot) return snapshot;
    const { errors, notes } = checkCandidate(this.state.ops, snapshot, {
      touched: new Set(),
      created: new Set(),
    });
    if (errors.length > 0) {
      return {
        error: `The proposal has problems: ${errors.join("; ")}. Fix them with the propose tools, then finalize again.`,
      };
    }
    this.state.finalizedSummary = text;
    return {
      status: "ready_for_review",
      changeCount: this.state.ops.length,
      notes,
      message:
        "The proposal is ready for the author to review. Nothing has been applied. Briefly tell the author what it does, then stop.",
    };
  }

  /**
   * Checks the moments write_moments was asked for: saved or new moments,
   * all in one scene, and the same scene as any prose already written this
   * turn. Returns them in story order with the snapshot whose prose
   * revisions become the baselines.
   */
  planProse(momentIds: string[]): { error: string } | ProsePlan {
    if (this.isFinalized) {
      return {
        error:
          "The proposal is already finalized. Describe it to the author and finish your reply.",
      };
    }
    const ids = [...new Set(momentIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return { error: "momentIds is empty" };
    if (ids.length > STUDIO_CHAT_MAX_MOMENTS_PER_CALL) {
      return {
        error: `write at most ${STUDIO_CHAT_MAX_MOMENTS_PER_CALL} moments per call`,
      };
    }
    const snapshot = this.snapshot();
    if ("error" in snapshot) return snapshot;
    const draft = new BuilderDraft(structuredClone(this.state), snapshot);
    const scenes = new Set<string | null>();
    const problems: string[] = [];
    for (const id of ids) {
      const resolved = draft.planItem(id);
      if (!resolved.ok) {
        problems.push(resolved.error);
      } else if (resolved.value.kind !== "moment") {
        problems.push(`${id} is a ${resolved.value.kind}, not a moment`);
      } else {
        scenes.add(resolved.value.parentRef);
      }
    }
    if (problems.length > 0) return { error: problems.join("; ") };
    const [sceneRef] = [...scenes];
    if (scenes.size !== 1 || !sceneRef) {
      return {
        error:
          "write_moments writes moments of one scene per turn; these belong to different scenes",
      };
    }
    if (this.state.proseSceneRef && this.state.proseSceneRef !== sceneRef) {
      return {
        error:
          "This turn already wrote moments in another scene. Prose is limited to one scene per turn; offer to continue in the next turn.",
      };
    }
    const preview = previewStudioWorkspace(
      snapshot.workspace,
      this.state.ops,
      day().toISOString(),
    );
    const order = new Map(
      getOrderedMoments(preview.planItems).map((item, index) => [
        item.id,
        index,
      ]),
    );
    return {
      snapshot,
      preview,
      sceneRef,
      momentRefs: ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    };
  }

  /**
   * Adds (or replaces) one moment's proposed prose. The baseline is the
   * saved prose in `plan.snapshot`, read before generation started, so an
   * author edit made while the model was writing shows up as a conflict.
   */
  addProse(
    plan: ProsePlan,
    momentRef: string,
    markdown: string,
  ): { error: string } | { opId: string } {
    if (this.isFinalized) {
      return { error: "The proposal is already finalized." };
    }
    if (markdown.length > MAX_PROSE_CHARS) {
      return { error: "The generated prose is too long to propose." };
    }
    this.state.proseSceneRef = plan.sceneRef;
    const existing = this.state.ops.find(
      (op): op is OpOf<"prose.write"> =>
        op.kind === "prose.write" && op.momentRef === momentRef,
    );
    if (existing) {
      existing.markdown = markdown;
      return { opId: existing.id };
    }
    const saved = plan.snapshot.rows.prose.get(momentRef);
    const current = saved?.markdown ?? "";
    const title =
      plan.preview.planItems.find((item) => item.id === momentRef)?.title ?? "";
    const op: OpOf<"prose.write"> = {
      id: `op-${this.state.nextOp}`,
      kind: "prose.write",
      label: `${current.trim() ? "Rewrite" : "Write"} moment ${quoted(title, "Untitled")}`,
      momentRef,
      baselineRevision: saved?.revision ?? 0,
      baselineHash: hashText(current),
      markdown,
    };
    this.state.nextOp += 1;
    this.state.ops.push(op);
    return { opId: op.id };
  }

  private snapshot(): BuilderSnapshot | { error: string } {
    try {
      return loadBuilderSnapshot(this.storyId);
    } catch (error) {
      if (error instanceof ActionError) return { error: error.publicMessage };
      throw error;
    }
  }

  private run(apply: (draft: BuilderDraft) => void): BuilderOutcome {
    if (this.isFinalized) {
      return {
        error:
          "The proposal is already finalized. Describe it to the author and finish your reply.",
      };
    }
    const snapshot = this.snapshot();
    if ("error" in snapshot) return snapshot;
    const draft = new BuilderDraft(structuredClone(this.state), snapshot);
    apply(draft);
    draft.runDeferred();
    if (draft.errors.length > 0) {
      return {
        error: `Nothing from this call was added. Fix these, then call the tool again with every item: ${draft.errors.join("; ")}`,
      };
    }
    const { errors, notes } = checkCandidate(draft.state.ops, snapshot, {
      touched: draft.touched,
      created: draft.created,
    });
    if (errors.length > 0) {
      return {
        error: `Nothing from this call was added: ${errors.join("; ")}`,
      };
    }
    this.state = draft.state;
    return {
      status: "added_to_proposal",
      added: draft.added.map(({ label, ref }) =>
        ref ? { label, id: ref } : { label },
      ),
      notes: [...draft.notes, ...notes],
      changeCount: this.state.ops.length,
      message:
        "Added to this turn's proposal. Nothing is applied until the author accepts it. Call finalize_bundle once after your last proposal.",
    };
  }
}
