import type {
  StudioChangeDto,
  StudioPlanItemDto,
  StudioProseDto,
} from "@/lib/studio/contracts";

export type StudioPlanNode = StudioPlanItemDto & { children: StudioPlanNode[] };

export type StudioPlanIndexEntry = {
  order: number;
  endOrder: number;
  ancestors: string[];
};

function compareSiblings(a: StudioPlanItemDto, b: StudioPlanItemDto): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds the plan tree. An item whose parent is missing from `items` is
 * treated as a root so a partial list never silently drops items.
 */
export function buildPlanTree(items: StudioPlanItemDto[]): StudioPlanNode[] {
  const nodes = new Map<string, StudioPlanNode>();
  for (const item of items) nodes.set(item.id, { ...item, children: [] });

  const roots: StudioPlanNode[] = [];
  for (const item of items) {
    const node = nodes.get(item.id);
    if (!node) continue;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const sortRecursive = (list: StudioPlanNode[]) => {
    list.sort(compareSiblings);
    for (const node of list) sortRecursive(node.children);
  };
  sortRecursive(roots);
  return roots;
}

function stripChildren(node: StudioPlanNode): StudioPlanItemDto {
  const { children: _children, ...item } = node;
  return item;
}

/** Preorder: each parent comes before its children. */
export function flattenPlan(items: StudioPlanItemDto[]): StudioPlanItemDto[] {
  const result: StudioPlanItemDto[] = [];
  const visit = (nodes: StudioPlanNode[]) => {
    for (const node of nodes) {
      result.push(stripChildren(node));
      visit(node.children);
    }
  };
  visit(buildPlanTree(items));
  return result;
}

export function getPlanIndex(
  items: StudioPlanItemDto[],
): Map<string, StudioPlanIndexEntry> {
  const index = new Map<string, StudioPlanIndexEntry>();
  let counter = 0;
  const visit = (nodes: StudioPlanNode[], ancestors: string[]) => {
    for (const node of nodes) {
      const order = counter++;
      index.set(node.id, { order, endOrder: order, ancestors });
      visit(node.children, [...ancestors, node.id]);
      const entry = index.get(node.id);
      if (entry) entry.endOrder = counter - 1;
    }
  };
  visit(buildPlanTree(items), []);
  return index;
}

export function getOrderedMoments(
  items: StudioPlanItemDto[],
): StudioPlanItemDto[] {
  return flattenPlan(items).filter((item) => item.kind === "moment");
}

function hasProse(
  proseByMomentId: Map<string, StudioProseDto>,
  momentId: string,
): boolean {
  const prose = proseByMomentId.get(momentId);
  return prose !== undefined && prose.markdown.trim().length > 0;
}

export function getNextUnwrittenMoment(
  items: StudioPlanItemDto[],
  proseByMomentId: Map<string, StudioProseDto>,
): StudioPlanItemDto | null {
  return (
    getOrderedMoments(items).find(
      (moment) => !hasProse(proseByMomentId, moment.id),
    ) ?? null
  );
}

export function getLastWrittenMoment(
  items: StudioPlanItemDto[],
  proseByMomentId: Map<string, StudioProseDto>,
): StudioPlanItemDto | null {
  const moments = getOrderedMoments(items);
  for (let i = moments.length - 1; i >= 0; i--) {
    if (hasProse(proseByMomentId, moments[i].id)) return moments[i];
  }
  return null;
}

/** Ancestors of `id`, root first. Does not include the item itself. */
export function getAncestors(
  items: StudioPlanItemDto[],
  id: string,
): StudioPlanItemDto[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: StudioPlanItemDto[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id);
  while (current?.parentId && !seen.has(current.parentId)) {
    const parent = byId.get(current.parentId);
    if (!parent) break;
    seen.add(parent.id);
    result.unshift(parent);
    current = parent;
  }
  return result;
}

/** Changes whose plan item exists, sorted into story replay order. */
export function sortChangesForReplay(
  changes: StudioChangeDto[],
  order: Map<string, { order: number }>,
): StudioChangeDto[] {
  return changes
    .filter((change) => order.has(change.planItemId))
    .sort((a, b) => {
      const orderA = order.get(a.planItemId)?.order ?? 0;
      const orderB = order.get(b.planItemId)?.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      if (a.position !== b.position) return a.position - b.position;
      if (a.createdAt !== b.createdAt)
        return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}
