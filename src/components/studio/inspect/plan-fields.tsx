"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { useWritingLoop } from "@/components/studio/manuscript/use-writing-loop";
import { AiActionsMenu } from "@/components/studio/workspace/ai-actions-menu";
import type { PlanAiController } from "@/components/studio/workspace/use-plan-ai";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { getInstructionStack } from "@/lib/studio/instructions";
import { getAncestors } from "@/lib/studio/plan-order";

import { chapterNumbers } from "./inspect-labels";
import { useAutosaveFields } from "./use-autosave-fields";
import { type PlanItemPatch, usePatchPlanItem } from "./use-patch-plan-item";

type PlanFieldsProps = {
  ai: PlanAiController;
  item: StudioPlanItemDto;
  onDelete: (item: StudioPlanItemDto) => void;
};

type FieldKey = "title" | "whatHappens" | "howToWrite" | "tension";

const KIND_LABEL = { chapter: "Chapter", scene: "Scene", moment: "Moment" };

function parseTension(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > 10) return undefined;
  return value;
}

export function PlanFields({ ai, item, onDelete }: PlanFieldsProps) {
  const { state } = useStudioStore();
  const loop = useWritingLoop();
  const patchItem = usePatchPlanItem();
  const [menuOpen, setMenuOpen] = useState(false);

  const save = useCallback(
    async (changed: Partial<Record<FieldKey, string>>) => {
      const patch: PlanItemPatch = {};
      if (changed.title !== undefined) patch.title = changed.title.trim();
      if (changed.whatHappens !== undefined)
        patch.whatHappens = changed.whatHappens;
      if (changed.howToWrite !== undefined)
        patch.howToWrite = changed.howToWrite;
      if (changed.tension !== undefined) {
        const tension = parseTension(changed.tension);
        // An out-of-range value stays local until it is a valid 1 to 10.
        if (tension !== undefined) patch.tension = tension;
      }
      if (Object.keys(patch).length === 0) return true;
      return (await patchItem(item.id, patch)) !== null;
    },
    [item.id, patchItem],
  );

  const { flush, setValue, values } = useAutosaveFields<FieldKey>({
    save,
    serverValues: {
      title: item.title,
      whatHappens: item.whatHappens,
      howToWrite: item.howToWrite,
      tension: item.tension === null ? "" : String(item.tension),
    },
  });

  const numbers = useMemo(
    () => chapterNumbers(state.planItems),
    [state.planItems],
  );
  const crumbs = useMemo(
    () =>
      getAncestors(state.planItems, item.id).map((ancestor) => ({
        id: ancestor.id,
        label:
          ancestor.kind === "chapter"
            ? `Ch ${numbers.get(ancestor.id) ?? ""}`.trim()
            : ancestor.title.trim() || "Untitled scene",
      })),
    [item.id, numbers, state.planItems],
  );

  const inherited = useMemo(() => {
    const layers = getInstructionStack(
      {
        globalInstructions: state.globalInstructions,
        story: state.story,
        planItems: state.planItems,
      },
      item.id,
    );
    return layers.filter(
      (layer) => layer.level !== "global" && layer.itemId !== item.id,
    );
  }, [item.id, state.globalInstructions, state.planItems, state.story]);
  const globalText = state.globalInstructions.trim();

  function inheritedLabel(layer: (typeof inherited)[number]): string {
    if (layer.level === "story") return "Story";
    const source = state.planItems.find((i) => i.id === layer.itemId);
    if (layer.level === "chapter") {
      return `Chapter ${source ? (numbers.get(source.id) ?? "") : ""}`.trim();
    }
    return source?.title.trim() ? `Scene "${source.title.trim()}"` : "Scene";
  }

  const fieldId = (name: string) => `inspect-${name}-${item.id}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <nav
          aria-label="Position in the plan"
          className="flex min-w-0 flex-wrap items-center gap-1 text-caption text-muted-foreground"
        >
          {crumbs.map((crumb) => (
            <Fragment key={crumb.id}>
              <span className="truncate">{crumb.label}</span>
              <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
            </Fragment>
          ))}
          <b className="font-semibold text-foreground">
            {KIND_LABEL[item.kind]}
          </b>
        </nav>
        <AiActionsMenu
          ai={ai}
          alwaysVisible
          item={item}
          onDelete={onDelete}
          onOpenChange={setMenuOpen}
          onWrite={(itemId) => void loop.write(itemId)}
          onWriteRestOfScene={(itemId, autoKeep) =>
            void loop.writeRestOfScene(itemId, autoKeep)
          }
          open={menuOpen}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label className="sr-only" htmlFor={fieldId("title")}>
          Title
        </Label>
        <Input
          className="font-semibold"
          id={fieldId("title")}
          maxLength={200}
          onBlur={() => void flush()}
          onChange={(event) => setValue("title", event.target.value)}
          placeholder={`Untitled ${item.kind}`}
          value={values.title}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label
          className="text-caption text-muted-foreground"
          htmlFor={fieldId("what")}
        >
          What happens
        </Label>
        <Textarea
          className="min-h-16"
          id={fieldId("what")}
          maxLength={20_000}
          onBlur={() => void flush()}
          onChange={(event) => setValue("whatHappens", event.target.value)}
          value={values.whatHappens}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label
          className="text-caption text-muted-foreground"
          htmlFor={fieldId("how")}
        >
          How to write it
        </Label>
        <Textarea
          className="min-h-16"
          id={fieldId("how")}
          maxLength={20_000}
          onBlur={() => void flush()}
          onChange={(event) => setValue("howToWrite", event.target.value)}
          value={values.howToWrite}
        />
      </div>

      {item.kind === "chapter" ? (
        <div className="flex items-center gap-2">
          <Label
            className="text-caption text-muted-foreground"
            htmlFor={fieldId("tension")}
          >
            Tension (1 to 10)
          </Label>
          <Input
            aria-invalid={parseTension(values.tension) === undefined}
            className="h-8 w-16"
            id={fieldId("tension")}
            inputMode="numeric"
            max={10}
            min={1}
            onBlur={() => void flush()}
            onChange={(event) => setValue("tension", event.target.value)}
            type="number"
            value={values.tension}
          />
        </div>
      ) : null}

      {inherited.length > 0 || globalText ? (
        <div className="flex flex-col gap-1 text-caption text-muted-foreground">
          {inherited.map((layer) => (
            <p
              className="line-clamp-3 whitespace-pre-line"
              key={`${layer.level}-${layer.itemId ?? "story"}`}
            >
              {"↳ also following: "}
              {inheritedLabel(layer)}: {layer.text}
            </p>
          ))}
          {globalText ? (
            <details>
              <summary className="cursor-pointer">
                LocalInk instructions
              </summary>
              <p className="mt-1 whitespace-pre-line">{globalText}</p>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
