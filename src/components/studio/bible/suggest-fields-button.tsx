"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/common/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { InspectPill } from "@/components/studio/inspect/inspect-section";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  STUDIO_MAX_ENTRY_FIELDS,
  type StudioEntryDto,
} from "@/lib/studio/contracts";
import type { StudioSuggestFieldsPreview } from "@/lib/studio/suggest-fields-contract";

import { NeverSaysPill } from "./bible-field";
import { useApplyEntrySuggestions } from "./use-patch-entry";

const SUGGEST_FAILED_MESSAGE = "Suggestions could not be made. Try again.";

/** Counts only: field labels and values never go into a toast. */
function capNotice(skipped: number, picked: number): string {
  const lead =
    skipped >= picked
      ? "None of the picked fields were added"
      : skipped === 1
        ? "1 picked field was not added"
        : `${skipped} picked fields were not added`;
  return `${lead}: an entry can hold at most ${STUDIO_MAX_ENTRY_FIELDS} fields.`;
}

/** Asks the model what else is worth tracking, then adds the picked fields. */
export function SuggestFieldsButton({ entry }: { entry: StudioEntryDto }) {
  const { state } = useStudioStore();
  const applySuggestions = useApplyEntrySuggestions();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<StudioSuggestFieldsPreview | null>(
    null,
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setLoading(false);
  }

  function close() {
    cancel();
    setOpen(false);
    setPreview(null);
  }

  async function start() {
    cancel();
    setPreview(null);
    const next = new AbortController();
    controller.current = next;
    setLoading(true);
    try {
      const result = await postStudioJson<StudioSuggestFieldsPreview>(
        "/api/studio/suggest-fields",
        { storyId: state.story.id, entryId: entry.id },
        next.signal,
      );
      if (next.signal.aborted) return;
      if (result.suggestions.length === 0) {
        toast.info("Nothing new to suggest for this entry.");
        setOpen(false);
        return;
      }
      setPicked(new Set(result.suggestions.map((item) => item.label)));
      setPreview(result);
    } catch (error) {
      if (next.signal.aborted) return;
      toast.error(studioErrorMessage(error, SUGGEST_FAILED_MESSAGE));
      setOpen(false);
    } finally {
      if (controller.current === next) {
        controller.current = null;
        setLoading(false);
      }
    }
  }

  async function addSelected() {
    if (!preview) return;
    setAdding(true);
    try {
      const saved = await applySuggestions(entry.id, preview.generationId, [
        ...picked,
      ]);
      if (!saved) return;
      if (saved.skippedForCap > 0) {
        toast.info(capNotice(saved.skippedForCap, picked.size));
      }
      close();
    } finally {
      setAdding(false);
    }
  }

  return (
    <Popover
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          void start();
        } else close();
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button size="sm" type="button" variant="outline">
          <span aria-hidden="true">✦</span>
          Suggest what to track
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[90vw]">
        {loading || !preview ? (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-body text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              Thinking about this entry…
            </span>
            <Button onClick={close} size="sm" type="button" variant="ghost">
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {preview.suggestions.map((item) => (
                <li key={item.label}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      checked={picked.has(item.label)}
                      className="mt-1 size-3.5 accent-primary"
                      onChange={(event) =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(item.label);
                          else next.delete(item.label);
                          return next;
                        })
                      }
                      type="checkbox"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium text-label-sm">
                          {item.label}
                        </span>
                        {item.steerOnly ? <NeverSaysPill /> : null}
                        {item.backstoryOnly ? (
                          <InspectPill>backstory only</InspectPill>
                        ) : null}
                      </span>
                      <span className="line-clamp-3 text-body">
                        {item.value}
                      </span>
                      {item.why ? (
                        <span className="text-caption text-muted-foreground">
                          {item.why}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button onClick={close} size="sm" type="button" variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={picked.size === 0}
                loading={adding}
                onClick={() => void addSelected()}
                size="sm"
                type="button"
              >
                Add selected
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
