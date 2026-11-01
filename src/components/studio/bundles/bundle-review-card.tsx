"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/common/button";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type {
  StudioBundleDto,
  StudioBundleOpDto,
  StudioBundleStatus,
} from "@/lib/studio/bundle-contract";

import { BUNDLE_OP_ID_ATTRIBUTE, BundleOpRow } from "./bundle-op-row";
import { useResolveBundle } from "./use-resolve-bundle";

type Area = "Story" | "Bible" | "Plan" | "Story state" | "Manuscript";

const AREAS: Area[] = ["Story", "Bible", "Plan", "Story state", "Manuscript"];

function areaOf(op: StudioBundleOpDto): Area {
  switch (op.kind) {
    case "story.update":
      return "Story";
    case "entry.create":
    case "entry.update":
    case "entry.delete":
      return "Bible";
    case "change.create":
    case "change.update":
    case "change.delete":
      return "Story state";
    case "prose.write":
      return "Manuscript";
    default:
      return "Plan";
  }
}

const STATUS_NOTE: Partial<Record<StudioBundleStatus, string>> = {
  rejected: "Discarded",
  undone: "Undone",
  accepted: "Accepted",
  "partially-accepted": "Partly accepted",
};

const HIGHLIGHT_MS = 2500;

type BundleReviewCardProps = {
  bundle: StudioBundleDto;
  /**
   * The op to scroll into view and briefly highlight. Defaults to the store's
   * `focusedBundleOpId`, which the Inspect link and manuscript marker set.
   */
  focusedOpId?: string | null;
};

/**
 * The review card for one change bundle: ops grouped by area with a checkbox
 * each (all checked), expandable diffs, and accept / discard / undo. Hosted
 * by the chat panel.
 */
export function BundleReviewCard({
  bundle,
  focusedOpId,
}: BundleReviewCardProps) {
  const { state } = useStudioStore();
  const { resolve, busy, issuesByOpId, clearIssues } = useResolveBundle();
  const rootRef = useRef<HTMLDivElement>(null);
  const isPending = bundle.status === "pending";
  const pendingOps = useMemo(
    () => bundle.operations.filter((op) => op.status === "pending"),
    [bundle.operations],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(pendingOps.map((op) => op.id)),
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const focusId = focusedOpId ?? state.focusedBundleOpId;
  const focusNonce = state.bundleFocusNonce;
  // The nonce re-runs this for a repeated focus on the same op.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focusNonce re-triggers the scroll.
  useEffect(() => {
    if (!focusId || !bundle.operations.some((op) => op.id === focusId)) return;
    setExpanded((current) =>
      current.has(focusId) ? current : new Set(current).add(focusId),
    );
    setHighlightId(focusId);
    const frame = window.requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[${BUNDLE_OP_ID_ATTRIBUTE}="${CSS.escape(focusId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [bundle.operations, focusId, focusNonce]);

  const groups = useMemo(
    () =>
      AREAS.map((area) => ({
        area,
        ops: bundle.operations.filter((op) => areaOf(op) === area),
      })).filter((group) => group.ops.length > 0),
    [bundle.operations],
  );

  function toggleSelected(opId: string, checked: boolean) {
    clearIssues();
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(opId);
      else next.delete(opId);
      return next;
    });
  }

  function toggleExpanded(opId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  }

  const selectedIds = pendingOps
    .filter((op) => selected.has(op.id))
    .map((op) => op.id);
  const canUndo =
    bundle.status === "accepted" || bundle.status === "partially-accepted";
  const issueCount = issuesByOpId.size;

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/50 p-3"
      ref={rootRef}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-label-sm">Proposed changes</h3>
        {STATUS_NOTE[bundle.status] ? (
          <span className="text-caption text-muted-foreground">
            {STATUS_NOTE[bundle.status]}
          </span>
        ) : null}
      </div>
      {bundle.summary.trim() ? (
        <p className="text-caption text-muted-foreground">{bundle.summary}</p>
      ) : null}

      {groups.map(({ area, ops }) => (
        <section aria-label={area} className="flex flex-col gap-1" key={area}>
          <h4 className="font-semibold text-caption text-muted-foreground uppercase tracking-wide">
            {area}
          </h4>
          <ul className="flex flex-col gap-0.5">
            {ops.map((op) => (
              <BundleOpRow
                bundlePending={isPending}
                checked={selected.has(op.id)}
                disabled={busy}
                expanded={expanded.has(op.id)}
                focused={highlightId === op.id}
                issues={issuesByOpId.get(op.id) ?? []}
                key={op.id}
                onCheckedChange={(checked) => toggleSelected(op.id, checked)}
                onToggleExpanded={() => toggleExpanded(op.id)}
                op={op}
                operations={bundle.operations}
              />
            ))}
          </ul>
        </section>
      ))}

      {issueCount > 0 ? (
        <p className="text-caption text-destructive" role="alert">
          {issueCount === 1
            ? "One change cannot be applied."
            : `${issueCount} changes cannot be applied.`}{" "}
          Deselect the marked ones to accept the rest.
        </p>
      ) : null}

      {isPending ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy || selectedIds.length === 0}
            loading={busy}
            onClick={() =>
              void resolve(
                bundle.id,
                "accept",
                selectedIds.length === pendingOps.length ? null : selectedIds,
              )
            }
            size="sm"
            type="button"
          >
            Accept selected ({selectedIds.length})
          </Button>
          <Button
            disabled={busy}
            onClick={() => void resolve(bundle.id, "accept", null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Accept all
          </Button>
          <Button
            disabled={busy}
            onClick={() => void resolve(bundle.id, "reject", null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Discard
          </Button>
        </div>
      ) : canUndo ? (
        <div>
          <Button
            disabled={busy}
            loading={busy}
            onClick={() => void resolve(bundle.id, "undo", null)}
            size="sm"
            type="button"
            variant="outline"
          >
            Undo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
