import type {
  StudioPlanItemDto,
  StudioStoryDto,
  StudioStyle,
} from "@/lib/studio/contracts";
import { getAncestors } from "@/lib/studio/plan-order";

export type StudioInstructionLayer = {
  level: "global" | "story" | "chapter" | "scene" | "moment";
  itemId?: string;
  text: string;
};

const STYLE_LABELS: { key: keyof StudioStyle; label: string }[] = [
  { key: "povAndTense", label: "POV and tense" },
  { key: "register", label: "Register" },
  { key: "pacing", label: "Pacing" },
  { key: "avoid", label: "Avoid" },
  { key: "notes", label: "Style notes" },
];

function storyLayerText(story: StudioStoryDto): string {
  const lines: string[] = [];
  const instructions = story.instructions.trim();
  if (instructions) lines.push(instructions);
  for (const { key, label } of STYLE_LABELS) {
    const value = story.style[key].trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  return lines.join("\n");
}

/** Instruction layers from broad to specific; empty layers are skipped. */
export function getInstructionStack(
  input: {
    globalInstructions: string;
    story: StudioStoryDto;
    planItems: StudioPlanItemDto[];
  },
  itemId: string,
): StudioInstructionLayer[] {
  const layers: StudioInstructionLayer[] = [
    { level: "global", text: input.globalInstructions.trim() },
    { level: "story", text: storyLayerText(input.story) },
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
