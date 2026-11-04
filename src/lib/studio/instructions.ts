import type { StudioPlanItemDto } from "@/lib/studio/contracts";
import { getAncestors } from "@/lib/studio/plan-order";

export type StudioInstructionLayer = {
  level: "global" | "chapter" | "scene" | "moment";
  itemId?: string;
  text: string;
};

/** Instruction layers from broad to specific; empty layers are skipped. */
export function getInstructionStack(
  input: {
    globalInstructions: string;
    planItems: StudioPlanItemDto[];
  },
  itemId: string,
): StudioInstructionLayer[] {
  const layers: StudioInstructionLayer[] = [
    { level: "global", text: input.globalInstructions.trim() },
  ];

  const item = input.planItems.find((candidate) => candidate.id === itemId);
  if (item) {
    const chain = [...getAncestors(input.planItems, itemId), item];
    for (const planItem of chain) {
      layers.push({
        level: planItem.kind,
        itemId: planItem.id,
        text: planItem.howToWrite.trim(),
      });
    }
  }

  return layers.filter((layer) => layer.text.length > 0);
}
