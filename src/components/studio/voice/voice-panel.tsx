"use client";

import { type ReactNode, useCallback, useState } from "react";

import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioVoiceMoment } from "@/lib/studio/contracts";
import type { StudioVoiceOp } from "@/lib/studio/voice";
import { describeStudioVoiceOp, isStudioVoiceSetUp } from "@/lib/studio/voice";
import { cn } from "@/lib/util";

import { useUpdateVoice } from "./use-update-voice";
import { useVoiceDrafts, voiceKey } from "./use-voice-drafts";
import { useVoiceFeedback } from "./use-voice-feedback";
import { VoiceEmptyState } from "./voice-empty-state";
import { VoiceSamples } from "./voice-samples";
import { VoiceSettingsColumn } from "./voice-settings-column";

export { useUpdateVoice } from "./use-update-voice";
export { useVoiceDrafts } from "./use-voice-drafts";
export { VoiceEmptyState } from "./voice-empty-state";

type VoicePanelProps = {
  /** "wide" sets the columns side by side; "stacked" fits the plan pane. */
  layout: "wide" | "stacked";
  footer?: ReactNode;
};

type ChooseOp = Extract<StudioVoiceOp, { kind: "choose" }>;

/**
 * Set the voice on the left, hear it on the right. A pick change rewrites the
 * sample you are looking at; "Not quite… what's off?" becomes a pick or a note.
 */
export function VoicePanel({ layout, footer }: VoicePanelProps) {
  const { state } = useStudioStore();
  const { story } = state;
  const updateVoice = useUpdateVoice();
  const draftApi = useVoiceDrafts();
  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [fromFeedback, setFromFeedback] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const onNewNotes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFromFeedback((prev) => new Set([...prev, ...ids]));
  }, []);
  const sendFeedback = useVoiceFeedback({ onNewNotes, write: draftApi.write });

  const { moments } = story.voice;
  const selected: StudioVoiceMoment | null =
    moments.find(
      (moment) =>
        selectedKind !== null &&
        voiceKey(moment.kind) === voiceKey(selectedKind),
    ) ??
    moments[0] ??
    null;

  async function choose(op: ChooseOp) {
    const changedLabel = describeStudioVoiceOp(op, story.voice) ?? undefined;
    const key = selected ? voiceKey(selected.kind) : null;
    const kept = key
      ? story.voiceSamples.find((s) => voiceKey(s.kind) === key)
      : undefined;
    const draft = key ? draftApi.drafts[key] : undefined;
    const previousText = draft?.text ?? kept?.text ?? draft?.previousText;
    const spot = draft?.planItemId ?? kept?.planItemId ?? selected?.planItemId;
    if (!(await updateVoice([op]))) return;
    // Only the tab on screen is rewritten.
    if (selected) {
      draftApi.write(selected.kind, spot ?? null, {
        previousText,
        changedLabel,
      });
    }
  }

  if (!isStudioVoiceSetUp(story)) return <VoiceEmptyState />;

  return (
    <div
      className={cn(
        layout === "wide"
          ? "grid min-h-0 grid-cols-[400px_1fr]"
          : "flex flex-col",
      )}
    >
      <div
        className={cn(
          "px-4 py-4",
          layout === "wide"
            ? "border-border border-r"
            : "border-border border-b",
        )}
      >
        <VoiceSettingsColumn
          fromFeedback={fromFeedback}
          onChoose={(op) => void choose(op)}
          onOps={(ops) => void updateVoice(ops)}
        />
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-col px-4 py-4",
          layout === "wide" && "px-6",
        )}
      >
        <VoiceSamples
          draftApi={draftApi}
          footer={footer}
          moments={moments}
          onFeedback={sendFeedback}
          onSelect={setSelectedKind}
          samples={story.voiceSamples}
          selected={selected}
        />
      </div>
    </div>
  );
}
