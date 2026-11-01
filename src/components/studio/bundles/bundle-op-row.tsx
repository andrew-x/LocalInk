"use client";

import { ChevronRight } from "lucide-react";
import { useId } from "react";

import type {
  StudioBundleIssueKind,
  StudioBundleOpDto,
  StudioBundleSelectionIssue,
} from "@/lib/studio/bundle-contract";
import { cn } from "@/lib/util";

import { BundleOpDiff } from "./bundle-op-diff";

/** The DOM hook Task 7's chat panel (and the focus handling) finds rows by. */
export const BUNDLE_OP_ID_ATTRIBUTE = "data-bundle-op-id";

const ISSUE_TEXT: Record<StudioBundleIssueKind, string> = {
  conflict:
    "Changed since this was proposed. Deselect it to accept the rest, or discard these changes.",
  "missing-dependency":
    "Needs another change that is not selected. Select that one too, or deselect this.",
  "too-many-fields":
    "Would leave this entry with more fields than are allowed.",
  invalid: "Cannot be applied as proposed.",
};

const OP_STATUS_LABEL = {
  accepted: "Applied",
  rejected: "Not applied",
  pending: "",
} as const;

type BundleOpRowProps = {
  op: StudioBundleOpDto;
  operations: StudioBundleOpDto[];
  /** Whether the bundle can still be accepted (pending). */
  bundlePending: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  focused: boolean;
  disabled: boolean;
  issues: StudioBundleSelectionIssue[];
};

export function BundleOpRow({
  op,
  operations,
  bundlePending,
  checked,
  onCheckedChange,
  expanded,
  onToggleExpanded,
  focused,
  disabled,
  issues,
}: BundleOpRowProps) {
  const diffId = useId();
  const selectable = bundlePending && op.status === "pending";
  return (
    <li
      {...{ [BUNDLE_OP_ID_ATTRIBUTE]: op.id }}
      className={cn(
        "rounded-md border border-transparent px-1.5 py-1 transition-colors",
        focused && "border-studio-moment-edge bg-studio-moment-highlight",
        issues.length > 0 && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-2">
        {selectable ? (
          <input
            aria-label={`Include “${op.label}”`}
            checked={checked}
            className="mt-1 size-3.5 shrink-0 accent-primary"
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
            type="checkbox"
          />
        ) : (
          <span aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <button
          aria-controls={expanded ? diffId : undefined}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-1 rounded-sm text-left text-label-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          onClick={onToggleExpanded}
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
              !bundlePending &&
                op.status === "rejected" &&
                "text-muted-foreground line-through",
            )}
          >
            {op.label}
          </span>
        </button>
        {!selectable && OP_STATUS_LABEL[op.status] ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            {OP_STATUS_LABEL[op.status]}
          </span>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <ul className="mt-1 ml-5 flex flex-col gap-0.5 text-caption text-destructive">
          {issues.map((issue) => (
            <li key={issue.kind}>{ISSUE_TEXT[issue.kind]}</li>
          ))}
        </ul>
      ) : null}
      {expanded ? (
        <div className="mt-1.5 ml-5" id={diffId}>
          <BundleOpDiff
            op={op}
            operations={operations}
            pending={bundlePending && op.status === "pending"}
          />
        </div>
      ) : null}
    </li>
  );
}
