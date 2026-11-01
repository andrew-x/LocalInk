import "server-only";

import { getDb } from "@/lib/drizzle/db";
import {
  isStudioBundleTempRef,
  type StudioBundleOpInput,
  type StudioBundleOpKind,
} from "@/lib/studio/bundle-contract";
import type {
  StudioChangeMode,
  StudioEntryDto,
  StudioEntryType,
  StudioPlanItemDto,
  StudioPlanKind,
  StudioWorkspace,
} from "@/lib/studio/contracts";

import {
  type AspectModeResolver,
  createAspectModeResolver,
} from "./aspect-modes";
import { captureStoryRows, type StudioStoryRows } from "./bundle-kit";
import {
  toChangeDto,
  toEntryDto,
  toFlagDto,
  toPlanItemDto,
  toProseDto,
  toStoryDto,
} from "./repository";

/**
 * Working state for the agent chat's bundle candidate: the ops proposed so
 * far in one turn, before anything is staged or saved. Each propose tool
 * call works on a copy (a draft) and commits it only when every item in the
 * call is valid, so a rejected call leaves no partial ops behind.
 */

export type OpOf<K extends StudioBundleOpKind> = Extract<
  StudioBundleOpInput,
  { kind: K }
>;

export type BuilderState = {
  ops: StudioBundleOpInput[];
  nextOp: number;
  /** Modes decided for labels new in this bundle, by entry ref + label. */
  decidedModes: Map<string, StudioChangeMode>;
  /** The scene whose moments this turn writes (one scene per turn). */
  proseSceneRef: string | null;
  finalizedSummary: string | null;
};

export function emptyBuilderState(): BuilderState {
  return {
    ops: [],
    nextOp: 1,
    decidedModes: new Map(),
    proseSceneRef: null,
    finalizedSummary: null,
  };
}

/** The saved story as read when a tool call runs; baselines come from it. */
export type BuilderSnapshot = {
  rows: StudioStoryRows;
  workspace: StudioWorkspace;
  entries: Map<string, StudioEntryDto>;
  items: Map<string, StudioPlanItemDto>;
  modes: AspectModeResolver;
};

export function loadBuilderSnapshot(storyId: string): BuilderSnapshot {
  return getDb().transaction((tx) => {
    const rows = captureStoryRows(tx, storyId);
    const entries = [...rows.entries.values()]
      .map(toEntryDto)
      .sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.position - b.position ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
    const planItems = [...rows.planItems.values()]
      .map(toPlanItemDto)
      .sort(
        (a, b) =>
          a.position - b.position || a.createdAt.localeCompare(b.createdAt),
      );
    const workspace: StudioWorkspace = {
      story: toStoryDto(rows.story),
      entries,
      planItems,
      changes: [...rows.changes.values()]
        .map(toChangeDto)
        .sort(
          (a, b) =>
            a.position - b.position || a.createdAt.localeCompare(b.createdAt),
        ),
      prose: [...rows.prose.values()].map(toProseDto),
      flags: [...rows.flags.values()]
        .map(toFlagDto)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      bundles: [],
    };
    return {
      rows,
      workspace,
      entries: new Map(entries.map((entry) => [entry.id, entry])),
      items: new Map(planItems.map((item) => [item.id, item])),
      modes: createAspectModeResolver(tx, storyId),
    };
  });
}

export const TEMP_ID_PATTERN = /^new:[A-Za-z0-9_.-]{1,64}$/;

export function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function quoted(text: string, fallback: string): string {
  const shown = clip(text, 60);
  return `“${shown || fallback}”`;
}

export type ResolvedEntry = {
  ref: string;
  name: string;
  type: StudioEntryType;
  customTypeLabel: string;
  temp: boolean;
};

export type ResolvedPlanItem = {
  ref: string;
  kind: StudioPlanKind;
  title: string;
  /** Saved parent id or a temp ref; null for chapters. */
  parentRef: string | null;
  temp: boolean;
};

type Resolution<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * One tool call's working copy. Items report errors by their position in
 * the call; `touched` records the ops this call added or changed and
 * `created` the ones it added, so the whole-bundle check can tell new
 * problems from older ones.
 */
export class BuilderDraft {
  readonly errors: string[] = [];
  readonly notes: string[] = [];
  readonly touched = new Set<string>();
  /** Ops this call created (their baselines were read just now). */
  readonly created = new Set<string>();
  readonly added: { opId: string; label: string; ref: string | null }[] = [];
  private readonly deferred: (() => void)[] = [];

  constructor(
    readonly state: BuilderState,
    readonly snap: BuilderSnapshot,
  ) {}

  fail(index: number, message: string): void {
    this.errors.push(`item ${index + 1}: ${message}`);
  }

  /**
   * Checks that run once every item in the call is in place, so an item may
   * refer to a new entry declared later in the same call.
   */
  defer(check: () => void): void {
    this.deferred.push(check);
  }

  runDeferred(): void {
    for (const check of this.deferred.splice(0)) check();
  }

  addOp<T extends StudioBundleOpInput>(
    op: Omit<T, "id">,
    ref: string | null = null,
  ): T {
    const full = { ...op, id: `op-${this.state.nextOp}` } as T;
    this.state.nextOp += 1;
    this.state.ops.push(full);
    this.touched.add(full.id);
    this.created.add(full.id);
    this.added.push({ opId: full.id, label: full.label, ref });
    return full;
  }

  markChanged(op: StudioBundleOpInput): void {
    this.touched.add(op.id);
  }

  removeOp(op: StudioBundleOpInput, note: string): void {
    this.state.ops = this.state.ops.filter((item) => item.id !== op.id);
    this.touched.delete(op.id);
    this.notes.push(note);
  }

  find<K extends StudioBundleOpKind>(
    kind: K,
    match: (op: OpOf<K>) => boolean,
  ): OpOf<K> | undefined {
    return this.state.ops.find(
      (op): op is OpOf<K> => op.kind === kind && match(op as OpOf<K>),
    );
  }

  filter<K extends StudioBundleOpKind>(
    kind: K,
    match: (op: OpOf<K>) => boolean = () => true,
  ): OpOf<K>[] {
    return this.state.ops.filter(
      (op): op is OpOf<K> => op.kind === kind && match(op as OpOf<K>),
    );
  }

  /** A saved entry, or one an entry.create in this bundle declares. */
  entry(ref: string | null): Resolution<ResolvedEntry> {
    const id = ref?.trim() ?? "";
    if (!id) return { ok: false, error: "an entry id is required" };
    if (isStudioBundleTempRef(id)) {
      const create = this.find("entry.create", (op) => op.tempId === id);
      if (!create) {
        return {
          ok: false,
          error: `no entry with id ${id} is proposed in this turn`,
        };
      }
      return {
        ok: true,
        value: {
          ref: id,
          name: create.entry.name,
          type: create.entry.type,
          customTypeLabel: create.entry.customTypeLabel,
          temp: true,
        },
      };
    }
    const entry = this.snap.entries.get(id);
    if (!entry) return { ok: false, error: `there is no entry with id ${id}` };
    if (this.find("entry.delete", (op) => op.entryId === id)) {
      return {
        ok: false,
        error: `entry ${id} is proposed for deletion in this turn`,
      };
    }
    return {
      ok: true,
      value: {
        ref: id,
        name: entry.name,
        type: entry.type,
        customTypeLabel: entry.customTypeLabel,
        temp: false,
      },
    };
  }

  /** Saved ids from `id` up to its chapter, including `id`. */
  savedChain(id: string): string[] {
    const chain: string[] = [];
    let current = this.snap.items.get(id);
    while (current && !chain.includes(current.id)) {
      chain.push(current.id);
      current = current.parentId
        ? this.snap.items.get(current.parentId)
        : undefined;
    }
    return chain;
  }

  /** True when the item or one of its saved ancestors is being deleted. */
  isDeletedPlanRef(ref: string): boolean {
    let savedId: string | null = ref;
    // A temp item sits under a saved one eventually (or is a chapter).
    const seen = new Set<string>();
    while (savedId && isStudioBundleTempRef(savedId) && !seen.has(savedId)) {
      seen.add(savedId);
      const temp: string = savedId;
      const create: OpOf<"plan.create"> | undefined = this.find(
        "plan.create",
        (op) => op.tempId === temp,
      );
      savedId = create?.item.parentRef ?? null;
    }
    if (!savedId) return false;
    const deleted = new Set(this.filter("plan.delete").map((op) => op.itemId));
    return this.savedChain(savedId).some((id) => deleted.has(id));
  }

  /** A saved plan item, or one a plan.create in this bundle declares. */
  planItem(ref: string | null): Resolution<ResolvedPlanItem> {
    const id = ref?.trim() ?? "";
    if (!id) return { ok: false, error: "a plan item id is required" };
    let value: ResolvedPlanItem;
    if (isStudioBundleTempRef(id)) {
      const create = this.find("plan.create", (op) => op.tempId === id);
      if (!create) {
        return {
          ok: false,
          error: `no plan item with id ${id} is proposed in this turn`,
        };
      }
      value = {
        ref: id,
        kind: create.item.kind,
        title: create.item.title,
        parentRef: create.item.parentRef,
        temp: true,
      };
    } else {
      const item = this.snap.items.get(id);
      if (!item) {
        return { ok: false, error: `there is no plan item with id ${id}` };
      }
      value = {
        ref: id,
        kind: item.kind,
        title: item.title,
        parentRef: item.parentId,
        temp: false,
      };
    }
    if (this.isDeletedPlanRef(id)) {
      return {
        ok: false,
        error: `${id} is proposed for deletion (or sits inside an item that is) in this turn`,
      };
    }
    return { ok: true, value };
  }

  entryName(ref: string): string {
    const resolved = this.entry(ref);
    if (resolved.ok) return resolved.value.name;
    return this.snap.entries.get(ref)?.name ?? ref;
  }
}
