"use client";

import { useId, useState } from "react";

import { updateStudioStory } from "@/actions/studio/update-studio-story";
import { BibleHeading } from "@/components/studio/bible/bible-field";
import {
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import {
  STORY_GENERATION_MODELS,
  storyGenerationModelSchema,
} from "@/lib/story-generation-models";

const SELECT_CLASS =
  "h-8 w-full max-w-72 min-w-0 rounded-md border border-input bg-card/80 px-2 text-caption shadow-xs outline-none transition-[background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:opacity-50";

type ModelKey = "proseModel" | "chatModel";

const MODEL_FIELDS: { key: ModelKey; label: string; failure: string }[] = [
  {
    key: "proseModel",
    label: "Prose model",
    failure: "The prose model could not be saved.",
  },
  {
    key: "chatModel",
    label: "Chat model",
    failure: "The chat model could not be saved.",
  },
];

export function ModelsSection() {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const idBase = useId();
  const [saving, setSaving] = useState<ModelKey | null>(null);
  const { story } = state;

  async function change(key: ModelKey, failure: string, value: string) {
    const parsed = storyGenerationModelSchema.safeParse(value);
    if (!parsed.success || parsed.data === story[key]) return;
    setSaving(key);
    try {
      const updated = await run(
        updateStudioStory({ storyId: story.id, patch: { [key]: parsed.data } }),
        failure,
      );
      if (updated) dispatch({ type: "merge", story: updated });
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <BibleHeading>Models</BibleHeading>
        <p className="text-body text-muted-foreground">
          Which model drafts prose, and which one answers in the chat.
        </p>
      </div>
      {MODEL_FIELDS.map(({ key, label, failure }) => (
        <div className="flex flex-col gap-1.5" key={key}>
          <label
            className="font-medium text-label-sm"
            htmlFor={`${idBase}-${key}`}
          >
            {label}
          </label>
          <select
            className={SELECT_CLASS}
            disabled={saving === key}
            id={`${idBase}-${key}`}
            onChange={(event) => void change(key, failure, event.target.value)}
            value={story[key]}
          >
            {STORY_GENERATION_MODELS.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
