"use client";

import { ChevronRight, Crosshair } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/common/button";
import { BundleOpDiff } from "@/components/studio/bundles/bundle-op-diff";
import { useBundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import { useResolveBundle } from "@/components/studio/bundles/use-resolve-bundle";
import { useFocusBundleOp } from "@/components/studio/workspace/use-studio-store";
import type {
  StudioBundleDto,
  StudioBundleOpDto,
} from "@/lib/studio/bundle-contract";
import { cn } from "@/lib/util";

import {
  revealElement,
  SuggestionButtons,
  SuggestionIssues,
  suggestionRowId,
} from "./suggestion-controls";
import { useChatSession } from "./use-chat-session";

function statusLabel(op: StudioBundleOpDto): string | null {
  switch (op.status) {
    case "accepted":
      return "Applied";
    case "undone":
      return "Undone";
    case "rejected":
      return op.dismissedBy === "new-message" ? "Not reviewed" : "Dismissed";
    default:
      return null;
  }
}

type OpRowProps = {
  bundle: StudioBundleDto;
  op: StudioBundleOpDto;
  expanded: boolean;
  onToggle: () => void;
  /** It shows in place (outline, Characters, manuscript): offer to go there. */
  placed: boolean;
};

function OpRow({ bundle, op, expanded, onToggle, placed }: OpRowProps) {
  const diffId = useId();
  const focusBundleOp = useFocusBundleOp();
  const pending = op.status === "pending";
  const label = statusLabel(op);
  return (
    <li
      className="rounded-md px-1 py-0.5"
      id={suggestionRowId(bundle.id, op.id)}
    >
      <div className="flex min-h-6 items-center gap-1">
        <button
          aria-controls={expanded ? diffId : undefined}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left text-label-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={onToggle}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span
            className={cn(
              "min-w-0 flex-1",
              op.status === "rejected" && "text-muted-foreground line-through",
              op.status === "undone" && "text-muted-foreground",
            )}
          >
            {op.label}
          </span>
        </button>
        {placed ? (
          <Button
            aria-label={`Show where: ${op.label}`}
            className="size-6"
            onClick={() => focusBundleOp({ bundleId: bundle.id, opId: op.id })}
            size="icon"
            tooltip="Show where it lands"
            type="button"
            variant="ghost"
          >
            <Crosshair aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
        {pending ? (
          <SuggestionButtons
            bundleId={bundle.id}
            label={op.label}
            opId={op.id}
          />
        ) : label ? (
          <span className="shrink-0 px-1 text-caption text-muted-foreground">
            {label}
          </span>
        ) : null}
      </div>
      <SuggestionIssues bundleId={bundle.id} className="ml-5" opId={op.id} />
      {expanded ? (
        <div className="mt-1 mb-1.5 ml-5" id={diffId}>
          <BundleOpDiff
            op={op}
            operations={bundle.operations}
            pending={pending}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Every op of one reply's proposal with its status, ✓/✕ for the ones still
 * pending, and its diff on demand. Tracking-only and story-settings ops show
 * nowhere else. Rings the op the AI box routed here.
 */
export function BundleOpsList({ bundle }: { bundle: StudioBundleDto }) {
  const { clearHighlight, highlight } = useChatSession();
  const preview = useBundlePreview();
  const { busy, resolve } = useResolveBundle();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [undoing, setUndoing] = useState(false);
  const canUndo = bundle.operations.some((op) => op.status === "accepted");
  const unplaced = new Set(preview.otherOps.map((op) => op.id));
  const isPreviewed = preview.bundleId === bundle.id;

  const target =
    highlight?.bundleId === bundle.id &&
    bundle.operations.some((op) => op.id === highlight.opId)
      ? highlight
      : null;
  useEffect(() => {
    if (!target) return;
    setExpanded((current) =>
      current.has(target.opId) ? current : new Set(current).add(target.opId),
    );
    revealElement(suggestionRowId(bundle.id, target.opId));
    clearHighlight(target.nonce);
  }, [bundle.id, clearHighlight, target]);

  function toggle(opId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(opId)) next.delete(opId);
      else next.add(opId);
      return next;
    });
  }

  async function undo() {
    setUndoing(true);
    try {
      await resolve(bundle.id, "undo", null);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <section
      aria-label="Suggested changes"
      className="flex flex-col gap-1 rounded-lg border border-studio-proposed/30 bg-studio-proposed/4 p-2"
    >
      <div className="flex items-center gap-2 px-1">
        <h3 className="font-semibold text-caption text-studio-proposed">
          Suggested changes
        </h3>
        {canUndo ? (
          <Button
            className="ml-auto h-6 px-2 text-caption"
            disabled={busy}
            loading={undoing}
            onClick={() => void undo()}
            size="sm"
            tooltip="Undo everything accepted from this proposal"
            type="button"
            variant="ghost"
          >
            Undo
          </Button>
        ) : null}
      </div>
      {bundle.summary.trim() ? (
        <p className="px-1 text-caption text-muted-foreground">
          {bundle.summary}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {bundle.operations.map((op) => (
          <OpRow
            bundle={bundle}
            expanded={expanded.has(op.id)}
            key={op.id}
            onToggle={() => toggle(op.id)}
            op={op}
            placed={
              isPreviewed && op.status === "pending" && !unplaced.has(op.id)
            }
          />
        ))}
      </ul>
    </section>
  );
}
