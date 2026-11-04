import "server-only";

import { getDb } from "@/lib/drizzle/db";
import {
  isStudioBundleTempRef,
  type StudioBundleChangeBaseline,
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
import type { StudioChangeRow } from "./repository";
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
  /**
   * The scene whose moments this turn writes (one scene per turn). Claimed
   * synchronously when write_moments starts, before any await, because the
   * SDK runs a step's tool calls concurrently.
   */
  proseSceneRef: string | null;
  /** True while a write_moments call is generating. */
  proseWriting: boolean;
  finalizedSummary: string | null;
  /**
   * Each saved record's baseline as first read by an op this turn (Ruling
   * A22). Every later op on the same record reuses it, so an author edit
   * made during the turn shows up as a conflict at accept instead of being
   * folded into a newer baseline.
   */
  seen: {
    entries: Map<string, { revision: number }>;
    items: Map<
      string,
      { revision: number; parentId: string | null; position: number }
    >;
    changes: Map<string, StudioBundleChangeBaseline>;
  };
};

export function emptyBuilderState(): BuilderState {
  return {
    ops: [],
    nextOp: 1,
    decidedModes: new Map(),
    proseSceneRef: null,
    proseWriting: false,
    finalizedSummary: null,
    seen: { entries: new Map(), items: new Map(), changes: new Map() },
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
      entrySuggestions: [],
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
  /**
   * Its parent once this bundle's creates and moves apply (saved id or temp
   * ref); null for chapters.
   */
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
  /** Records whose baselines were read before this call. */
  private readonly seenBefore: {
    entries: Set<string>;
    items: Set<string>;
    changes: Set<string>;
  };

  constructor(
    readonly state: BuilderState,
    readonly snap: BuilderSnapshot,
  ) {
    this.seenBefore = {
      entries: new Set(state.seen.entries.keys()),
      items: new Set(state.seen.items.keys()),
      changes: new Set(state.seen.changes.keys()),
    };
  }

  /**
   * True when the op's baseline was read in this call, so a conflict on it
   * cannot come from an author edit during the turn.
   */
  hasFreshBaseline(op: StudioBundleOpInput): boolean {
    switch (op.kind) {
      case "entry.update":
      case "entry.delete":
        return !this.seenBefore.entries.has(op.entryId);
      case "plan.update":
      case "plan.move":
      case "plan.delete":
        return !this.seenBefore.items.has(op.itemId);
      case "change.update":
      case "change.delete":
        return !this.seenBefore.changes.has(op.changeId);
      default:
        return true;
    }
  }

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

  /**
   * The parent a plan ref has once this bundle's creates and moves apply: a
   * new item's parentRef, a moved item's new parent, otherwise its saved
   * parent. Previews and accept place items the same way.
   */
  parentOf(ref: string): string | null {
    if (isStudioBundleTempRef(ref)) {
      const create: OpOf<"plan.create"> | undefined = this.find(
        "plan.create",
        (op) => op.tempId === ref,
      );
      return create?.item.parentRef ?? null;
    }
    const move = this.find("plan.move", (op) => op.itemId === ref);
    if (move) return move.newParentRef;
    return this.snap.items.get(ref)?.parentId ?? null;
  }

  /** `ref` and its ancestors after this bundle's moves, up to its chapter. */
  chain(ref: string): string[] {
    const chain: string[] = [];
    let current: string | null = ref;
    while (current !== null && !chain.includes(current)) {
      chain.push(current);
      current = this.parentOf(current);
    }
    return chain;
  }

  /**
   * True when the item, or an item it sits in once this bundle's moves
   * apply, is being deleted. An item moved out of a deleted one survives
   * (accept moves before it deletes).
   */
  isDeletedPlanRef(ref: string): boolean {
    const deleted = new Set(this.filter("plan.delete").map((op) => op.itemId));
    return this.chain(ref).some((id) => deleted.has(id));
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
        parentRef: this.parentOf(id),
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

  /** The entry's first-seen baseline this turn (see BuilderState.seen). */
  entryBaseline(entry: StudioEntryDto): { revision: number } {
    let seen = this.state.seen.entries.get(entry.id);
    if (!seen) {
      seen = { revision: entry.revision };
      this.state.seen.entries.set(entry.id, seen);
    }
    return seen;
  }

  /** The plan item's first-seen revision and stored place this turn. */
  itemBaseline(item: StudioPlanItemDto): {
    revision: number;
    parentId: string | null;
    position: number;
  } {
    let seen = this.state.seen.items.get(item.id);
    if (!seen) {
      seen = {
        revision: item.revision,
        parentId: item.parentId,
        position: item.position,
      };
      this.state.seen.items.set(item.id, seen);
    }
    return seen;
  }

  /** The change record's first-seen values this turn. */
  changeBaseline(row: StudioChangeRow): StudioBundleChangeBaseline {
    let seen = this.state.seen.changes.get(row.id);
    if (!seen) {
      seen = {
        aspect: row.aspect,
        mode: row.mode,
        value: row.value,
        aboutEntryId: row.aboutEntryId,
        planItemId: row.planItemId,
      };
      this.state.seen.changes.set(row.id, seen);
    }
    return { ...seen };
  }

  entryName(ref: string): string {
    const resolved = this.entry(ref);
    if (resolved.ok) return resolved.value.name;
    return this.snap.entries.get(ref)?.name ?? ref;
  }
}
