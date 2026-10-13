"use client";

import { Check, Undo2, X } from "lucide-react";

import { Button } from "@/components/common/button";
import type {
  StoryDetailsChange,
  StoryDetailsEntryChange,
  StoryDetailsProposal,
} from "@/lib/story-details-contract";
import type { ManuscriptProposalDecision } from "@/lib/story-manuscript-contract";

export class StoryDetailsResolutionError extends Error {}

type StoryDetailsProposalReviewProps = {
  proposal: StoryDetailsProposal;
  disabled: boolean;
  pendingDecision?: ManuscriptProposalDecision;
  error?: string;
  onResolve: (
    proposal: StoryDetailsProposal,
    decision: ManuscriptProposalDecision,
  ) => Promise<void>;
};

const FIELD_LABELS = {
  name: "Story title",
  description: "Description",
  backstory: "Backstory",
  style: "Style guide",
  systemInstructions: "Story instructions",
  characters: "Characters",
  locations: "Locations",
  voiceExemplars: "Voice examples",
} as const;

const STATUS_LABELS = {
  pending: "Awaiting your approval",
  accepted: "Applied to story details",
  rejected: "Denied · story details unchanged",
  undone: "Undone · original details restored",
} as const;

const ENTRY_LABELS = {
  characters: "character",
  locations: "location",
  voiceExemplars: "voice example",
} as const;

function changeLabel(change: StoryDetailsChange) {
  if (!("entryId" in change)) return FIELD_LABELS[change.field];
  const entry = change.after ?? change.before;
  const operation = !change.before
    ? "Add"
    : !change.after
      ? "Remove"
      : "Update";
  const name = entry ? ("name" in entry ? entry.name : entry.label) : "";
  return `${operation} ${ENTRY_LABELS[change.field]}${name ? ` · ${name}` : ""}`;
}

export function StoryDetailsProposalReview({
  proposal,
  disabled,
  pendingDecision,
  error,
  onResolve,
}: StoryDetailsProposalReviewProps) {
  return (
    <section
      aria-label="Proposed story detail edits"
      aria-busy={Boolean(pendingDecision)}
      className="grid min-w-0 gap-3 rounded-md border border-border bg-card/70 p-3"
    >
      <div className="grid gap-1">
        <h3 className="text-label">Story detail edits</h3>
        <p className="whitespace-pre-wrap break-words text-label-sm font-normal leading-5">
          {proposal.summary}
        </p>
        <p aria-live="polite" className="text-caption text-muted-foreground">
          {pendingDecision === "approve"
            ? "Applying edits…"
            : pendingDecision === "deny"
              ? "Denying edits…"
              : pendingDecision === "undo"
                ? "Restoring original details…"
                : STATUS_LABELS[proposal.status]}
        </p>
      </div>
      <div className="grid min-w-0 gap-2">
        {proposal.changes.map((change) => (
          <details
            className="min-w-0 rounded-md border border-border/80"
            key={
              "entryId" in change
                ? `${change.field}:${change.entryId}`
                : change.field
            }
            open
          >
            <summary className="cursor-pointer px-2.5 py-2 text-label-sm">
              {changeLabel(change)}
            </summary>
            <div className="grid min-w-0 gap-2 border-border/80 border-t p-2.5">
              <StoryDetailsValue label="Before" value={change.before} />
              <StoryDetailsValue label="After" value={change.after} />
            </div>
          </details>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
      {proposal.status === "pending" ? (
        <div className="grid gap-2">
          <p className="text-caption text-muted-foreground">
            Approve applies all detail edits together.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled}
              leftSection={<Check aria-hidden="true" />}
              loading={pendingDecision === "approve"}
              onClick={() => void onResolve(proposal, "approve")}
              size="sm"
              type="button"
            >
              Approve
            </Button>
            <Button
              disabled={disabled}
              leftSection={<X aria-hidden="true" />}
              loading={pendingDecision === "deny"}
              onClick={() => void onResolve(proposal, "deny")}
              size="sm"
              type="button"
              variant="outline"
            >
              Deny
            </Button>
          </div>
        </div>
      ) : proposal.status === "accepted" ? (
        <div className="grid justify-items-start gap-2">
          <Button
            disabled={disabled}
            leftSection={<Undo2 aria-hidden="true" />}
            loading={pendingDecision === "undo"}
            onClick={() => void onResolve(proposal, "undo")}
            size="sm"
            type="button"
            variant="outline"
          >
            Undo edits
          </Button>
          <p className="text-caption text-muted-foreground">
            Undo restores the affected details if they have not changed since
            approval.
          </p>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        Send another message to request a revised proposal.
      </p>
    </section>
  );
}

function StoryDetailsValue({
  label,
  value,
}: {
  label: "Before" | "After";
  value: StoryDetailsChange["before"];
}) {
  return (
    <div
      className={
        label === "Before"
          ? "min-w-0 rounded border border-border bg-muted/35 p-2"
          : "min-w-0 rounded border border-primary/30 bg-primary/5 p-2"
      }
    >
      <p className="mb-1 text-caption font-semibold text-muted-foreground">
        {label}
      </p>
      {value === null ||
      ((typeof value === "string" || Array.isArray(value)) &&
        value.length === 0) ? (
        <p className="text-caption italic text-muted-foreground">None</p>
      ) : (
        <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-content text-[0.8125rem] leading-6">
          {typeof value === "string" ? (
            value
          ) : Array.isArray(value) ? (
            <ul className="grid gap-3">
              {value.map((entry) => (
                <li key={entry.id}>
                  <StoryDetailsEntry entry={entry} />
                </li>
              ))}
            </ul>
          ) : (
            <StoryDetailsEntry entry={value} />
          )}
        </div>
      )}
    </div>
  );
}

function StoryDetailsEntry({
  entry,
}: {
  entry: NonNullable<StoryDetailsEntryChange["before"]>;
}) {
  return (
    <>
      <p className="font-semibold">
        {"name" in entry ? entry.name : entry.label}
      </p>
      <p>{"description" in entry ? entry.description : entry.text}</p>
    </>
  );
}
