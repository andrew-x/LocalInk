"use client";

import { useState } from "react";

import { Button } from "@/components/common/button";
import { useBundlePreview } from "@/components/studio/bundles/use-bundle-preview";
import { useResolveBundle } from "@/components/studio/bundles/use-resolve-bundle";
import {
  useFocusBundleOp,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import type { StudioBundleDto } from "@/lib/studio/bundle-contract";

const BAR_BUTTON =
  "h-6 px-1.5 font-semibold text-caption text-muted-foreground hover:text-foreground";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The newest bundle in the store, by creation. */
function newestBundle(bundles: StudioBundleDto[]): StudioBundleDto | null {
  let newest: StudioBundleDto | null = null;
  for (const bundle of bundles) {
    if (
      !newest ||
      bundle.createdAt > newest.createdAt ||
      (bundle.createdAt === newest.createdAt && bundle.id > newest.id)
    ) {
      newest = bundle;
    }
  }
  return newest;
}

/**
 * "N suggestions · Accept all · Dismiss all", plus Undo once anything from
 * that proposal is accepted (still there while other ops wait). It speaks
 * for the proposal with pending ops, else for the newest proposal while
 * something from it can be undone. The count jumps to the first suggestion.
 */
export function SuggestionBar() {
  const { state } = useStudioStore();
  const preview = useBundlePreview();
  const { busy, issueCount, resolve } = useResolveBundle();
  const focusBundleOp = useFocusBundleOp();
  const [action, setAction] = useState<"accept" | "reject" | "undo" | null>(
    null,
  );

  const pendingBundle = preview.bundleId
    ? (state.bundles.find((bundle) => bundle.id === preview.bundleId) ?? null)
    : null;
  const bundle = pendingBundle ?? newestBundle(state.bundles);
  if (!bundle) return null;
  const pending = bundle.operations.filter((op) => op.status === "pending");
  const accepted = bundle.operations.filter(
    (op) => op.status === "accepted",
  ).length;
  if (pending.length === 0 && accepted === 0) return null;
  const refused = issueCount(bundle.id);

  async function run(decision: "accept" | "reject" | "undo") {
    if (!bundle) return;
    setAction(decision);
    try {
      await resolve(bundle.id, decision, null);
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="flex min-h-6 flex-wrap items-center gap-x-0.5 px-0.5 text-caption">
      {pending.length > 0 ? (
        <>
          <button
            className="mr-1 rounded-sm font-semibold text-studio-proposed underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() =>
              focusBundleOp({ bundleId: bundle.id, opId: pending[0].id })
            }
            type="button"
          >
            {plural(pending.length, "suggestion")}
          </button>
          <span aria-hidden="true" className="text-muted-foreground/60">
            ·
          </span>
          <Button
            className={BAR_BUTTON}
            disabled={busy}
            loading={busy && action === "accept"}
            onClick={() => void run("accept")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Accept all
          </Button>
          <span aria-hidden="true" className="text-muted-foreground/60">
            ·
          </span>
          <Button
            className={BAR_BUTTON}
            disabled={busy}
            loading={busy && action === "reject"}
            onClick={() => void run("reject")}
            size="sm"
            type="button"
            variant="ghost"
          >
            Dismiss all
          </Button>
        </>
      ) : (
        <span className="mr-1 text-muted-foreground">
          {plural(accepted, "suggestion")} applied
        </span>
      )}
      {accepted > 0 ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground/60">
            ·
          </span>
          <Button
            className={BAR_BUTTON}
            disabled={busy}
            loading={busy && action === "undo"}
            onClick={() => void run("undo")}
            size="sm"
            tooltip="Undo everything accepted from this proposal"
            type="button"
            variant="ghost"
          >
            Undo
          </Button>
        </>
      ) : null}
      {refused > 0 ? (
        <span className="basis-full px-0.5 text-destructive" role="alert">
          {refused === 1
            ? "One suggestion can't be applied."
            : `${refused} suggestions can't be applied.`}{" "}
          Dismiss the marked ones to accept the rest.
        </span>
      ) : null}
    </div>
  );
}
