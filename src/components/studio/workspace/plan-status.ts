import type {
  StudioFlagDto,
  StudioPlanItemDto,
  StudioProseDto,
} from "@/lib/studio/contracts";
import { buildPlanTree, type StudioPlanNode } from "@/lib/studio/plan-order";

export type StudioPlanStatus = "written" | "planned" | "flagged";

/**
 * Moment: flagged with an open flag, written with prose, otherwise planned.
 * Chapter/scene: flagged if any descendant is flagged, written if it has
 * moments and every one has prose, otherwise planned.
 */
export function computePlanStatuses(
  items: StudioPlanItemDto[],
  prose: StudioProseDto[],
  flags: StudioFlagDto[],
): Map<string, StudioPlanStatus> {
  const written = new Set(
    prose.filter((p) => p.markdown.trim().length > 0).map((p) => p.momentId),
  );
  const flagged = new Set(
    flags.filter((f) => f.status === "open").map((f) => f.planItemId),
  );
  const statuses = new Map<string, StudioPlanStatus>();

  const visit = (
    node: StudioPlanNode,
  ): { flagged: boolean; moments: number; written: number } => {
    const totals = {
      flagged: flagged.has(node.id),
      moments: node.kind === "moment" ? 1 : 0,
      written: node.kind === "moment" && written.has(node.id) ? 1 : 0,
    };
    for (const child of node.children) {
      const sub = visit(child);
      totals.flagged ||= sub.flagged;
      totals.moments += sub.moments;
      totals.written += sub.written;
    }
    statuses.set(
      node.id,
      totals.flagged
        ? "flagged"
        : totals.moments > 0 && totals.written === totals.moments
          ? "written"
          : "planned",
    );
    return totals;
  };

  for (const root of buildPlanTree(items)) visit(root);
  return statuses;
}
