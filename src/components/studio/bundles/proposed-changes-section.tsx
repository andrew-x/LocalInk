"use client";

import { useState } from "react";

import { InspectSection } from "@/components/studio/inspect/inspect-section";
import { useFocusBundleOp } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";

import { BundleOpDiff } from "./bundle-op-diff";
import { useBundlePreview } from "./use-bundle-preview";

/**
 * Inspect's "Proposed changes": the pending ops that touch the selected item,
 * with their diffs and a link to the op's review card in chat.
 */
export function ProposedChangesSection({ item }: { item: StudioPlanItemDto }) {
  const { opsForItem, pending } = useBundlePreview();
  const focusBundleOp = useFocusBundleOp();
  const [open, setOpen] = useState<string | null>(null);
  const ops = opsForItem(item.id);
  if (!pending || ops.length === 0) return null;

  return (
    <InspectSection
      className="border-studio-proposed/50 border-dashed"
      meta={`${ops.length} pending`}
      title="Proposed changes"
    >
      <ul className="flex flex-col gap-2">
        {ops.map((op) => (
          <li className="flex flex-col gap-1.5" key={op.id}>
            <div className="flex items-start justify-between gap-2">
              <button
                aria-expanded={open === op.id}
                className="min-w-0 rounded-sm text-left text-label-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setOpen(open === op.id ? null : op.id)}
                type="button"
              >
                {op.label}
              </button>
              <button
                className="shrink-0 rounded-sm text-caption text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => focusBundleOp(op.id)}
                type="button"
              >
                Review in chat
              </button>
            </div>
            {open === op.id ? (
              <BundleOpDiff op={op} operations={pending.operations} pending />
            ) : null}
          </li>
        ))}
      </ul>
    </InspectSection>
  );
}
