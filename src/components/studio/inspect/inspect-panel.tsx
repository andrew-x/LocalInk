"use client";

import { ProposedChangesSection } from "@/components/studio/bundles/proposed-changes-section";
import { usePlanAi } from "@/components/studio/workspace/use-plan-ai";
import { usePlanTreeActions } from "@/components/studio/workspace/use-plan-tree-actions";
import { useSelectedItem } from "@/components/studio/workspace/use-studio-store";

import { AiSeesChips } from "./ai-sees-chips";
import { ChangesSection } from "./changes-section";
import { CraftDetails } from "./craft-details";
import { FlagsSection } from "./flags-section";
import { PlanFields } from "./plan-fields";
import { ProseSection } from "./prose-section";
import { StateSection } from "./state-section";
import { WhoIsInIt } from "./who-is-in-it";

/**
 * The right column's Inspect tab (the workspace's tablist labels it).
 * Everything here works without the AI.
 */
export function InspectPanel() {
  const item = useSelectedItem();
  const ai = usePlanAi();
  const { remove } = usePlanTreeActions();

  return (
    <div className="flex flex-col">
      {item ? (
        // Keyed so local drafts never carry over to another item.
        <div className="flex flex-col gap-3 p-4" key={item.id}>
          <FlagsSection item={item} />
          <ProposedChangesSection item={item} />
          <PlanFields
            ai={ai}
            item={item}
            onDelete={(target) => void remove(target)}
          />
          <WhoIsInIt item={item} />
          <StateSection item={item} />
          <ChangesSection item={item} />
          {item.kind === "moment" ? <ProseSection item={item} /> : null}
          {item.kind === "moment" ? <AiSeesChips item={item} /> : null}
          <CraftDetails item={item} />
        </div>
      ) : (
        <p className="p-4 text-caption text-muted-foreground">
          Select a chapter, scene, or moment in the plan to see and edit its
          details.
        </p>
      )}
    </div>
  );
}
