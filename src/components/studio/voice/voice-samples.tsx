"use client";

import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/common/input";
import {
  MENU_ITEM_CLASS,
  OutlineMenu,
} from "@/components/studio/outline/scene-menu";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type {
  StudioPlanItemDto,
  StudioVoiceMoment,
  StudioVoiceSample,
} from "@/lib/studio/contracts";
import { STUDIO_VOICE_LIMITS } from "@/lib/studio/voice";
import { cn } from "@/lib/util";
import { useUpdateVoice } from "./use-update-voice";
import { type VoiceDrafts, voiceKey } from "./use-voice-drafts";
import type { VoiceFeedbackInput } from "./use-voice-feedback";
import { VoiceSampleView } from "./voice-sample-view";

/** Chapter and scene titles for a plan item, or the imagined-moment line. */
function describeSpot(
  planItems: StudioPlanItemDto[],
  planItemId: string | null,
): string {
  const imagined = "A moment the AI imagined for this story";
  if (!planItemId) return imagined;
  const byId = new Map(planItems.map((item) => [item.id, item]));
  const titles: string[] = [];
  for (
    let item = byId.get(planItemId);
    item;
    item = item.parentId ? byId.get(item.parentId) : undefined
  ) {
    if (item.kind !== "moment" && item.title.trim()) titles.unshift(item.title);
  }
  return titles.length > 0 ? titles.join(" · ") : imagined;
}

type VoiceSamplesProps = {
  moments: StudioVoiceMoment[];
  samples: StudioVoiceSample[];
  selected: StudioVoiceMoment | null;
  onSelect: (kind: string) => void;
  draftApi: VoiceDrafts;
  onFeedback: (input: VoiceFeedbackInput) => Promise<boolean>;
  footer?: ReactNode;
};

/** One tab per kind of moment, and the selected tab's sample. */
export function VoiceSamples({
  moments,
  samples,
  selected,
  onSelect,
  draftApi,
  onFeedback,
  footer,
}: VoiceSamplesProps) {
  const { state } = useStudioStore();
  const updateVoice = useUpdateVoice();
  const { drafts, write, keep, clear } = draftApi;
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const keptByKey = useMemo(
    () => new Map(samples.map((sample) => [voiceKey(sample.kind), sample])),
    [samples],
  );
  const selectedKey = selected ? voiceKey(selected.kind) : null;
  const kept = selectedKey ? keptByKey.get(selectedKey) : undefined;
  const draft = selectedKey ? drafts[selectedKey] : undefined;

  // Opening a tab with nothing kept writes a first sample for it.
  const needsWrite = selected !== null && !kept && !draft;
  useEffect(() => {
    if (needsWrite && selected) write(selected.kind, selected.planItemId);
  }, [needsWrite, selected, write]);

  const keptCount = moments.filter((moment) => {
    const sample = keptByKey.get(voiceKey(moment.kind));
    return sample && !sample.stale;
  }).length;

  const spot = draft?.planItemId ?? kept?.planItemId ?? selected?.planItemId;

  async function addMoment(text: string) {
    setAdding(false);
    const label = text.trim();
    if (!label) return;
    if (await updateVoice([{ kind: "add-moment", label }])) {
      onSelect(label.slice(0, STUDIO_VOICE_LIMITS.kindChars).trim());
    }
  }

  async function removeMoment(moment: StudioVoiceMoment) {
    setMenuFor(null);
    if (await updateVoice([{ kind: "remove-moment", momentId: moment.id }])) {
      clear(moment.kind);
    }
  }

  const addControl = adding ? (
    <Input
      aria-label="A kind of moment"
      autoFocus
      className="h-7 w-40 text-label-sm"
      maxLength={STUDIO_VOICE_LIMITS.kindChars}
      onBlur={(event) => void addMoment(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.currentTarget.value = "";
          event.currentTarget.blur();
        }
      }}
      placeholder="A fight, a quiet scene…"
    />
  ) : moments.length < STUDIO_VOICE_LIMITS.moments ? (
    <button
      className="-mb-px flex cursor-pointer items-center gap-1 border-transparent border-b-2 px-2.5 py-1.5 text-label-sm font-normal text-muted-foreground/80 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={() => setAdding(true)}
      type="button"
    >
      <Plus aria-hidden="true" className="size-3" />
      Add
    </button>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        aria-label="Kinds of moments"
        className="flex flex-wrap items-center gap-x-1 border-border border-b"
        role="tablist"
      >
        {moments.map((moment) => {
          const isSelected = moment.id === selected?.id;
          const sample = keptByKey.get(voiceKey(moment.kind));
          return (
            <div className="-mb-px flex items-center" key={moment.id}>
              <button
                aria-selected={isSelected}
                className={cn(
                  "flex cursor-pointer items-center gap-1 border-b-2 px-2.5 py-1.5 text-label-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  isSelected
                    ? "border-studio-proposed text-foreground"
                    : "border-transparent font-normal text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onSelect(moment.kind)}
                role="tab"
                type="button"
              >
                {sample && !sample.stale ? (
                  <span aria-label="Kept" className="text-primary" role="img">
                    ✓
                  </span>
                ) : null}
                {sample?.stale ? (
                  <span
                    aria-label="Written before your changes"
                    className="size-1.5 rounded-full bg-studio-proposed"
                    role="img"
                  />
                ) : null}
                {moment.kind}
              </button>
              {isSelected ? (
                <OutlineMenu
                  label={`More for ${moment.kind}`}
                  onOpenChange={(open) => setMenuFor(open ? moment.id : null)}
                  open={menuFor === moment.id}
                >
                  <button
                    className={cn(MENU_ITEM_CLASS, "text-destructive")}
                    onClick={() => void removeMoment(moment)}
                    type="button"
                  >
                    Remove
                  </button>
                </OutlineMenu>
              ) : null}
            </div>
          );
        })}
        {addControl}
      </div>

      {selected ? (
        <div className="flex flex-col gap-3" key={selected.id} role="tabpanel">
          <p className="text-caption text-muted-foreground/80">
            {describeSpot(state.planItems, spot ?? null)}
          </p>
          <VoiceSampleView
            draft={draft}
            kept={kept}
            onConfirmKept={() =>
              kept &&
              void updateVoice([{ kind: "confirm-sample", sampleId: kept.id }])
            }
            onFeedback={(complaint) =>
              onFeedback({
                kind: selected.kind,
                planItemId: spot ?? null,
                sample:
                  draft?.status === "ready" && draft.generationId
                    ? { generationId: draft.generationId }
                    : { sampleId: kept?.id ?? "" },
                complaint,
                previousText: draft?.text ?? kept?.text ?? "",
              })
            }
            onKeepDraft={() => keep(selected.kind)}
            onRewrite={(previousText) =>
              write(selected.kind, spot ?? null, { previousText })
            }
          />
        </div>
      ) : (
        <p className="text-label-sm font-normal text-muted-foreground">
          Add a kind of moment to hear the voice.
        </p>
      )}

      <div className="mt-auto flex items-center gap-2 border-border border-t pt-3 text-caption text-muted-foreground">
        <span>
          {keptCount} of {moments.length} kept
        </span>
        <span className="flex-1" />
        {footer}
      </div>
    </div>
  );
}
