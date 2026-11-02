"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Textarea } from "@/components/common/textarea";
import { useAutosaveFields } from "@/components/studio/shared/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import {
  STUDIO_MAX_VOICE_SAMPLE_CHARS,
  STUDIO_MAX_VOICE_SAMPLES,
  type StudioStyle,
  type StudioVoiceSample,
} from "@/lib/studio/contracts";
import { generateId } from "@/lib/util";
import { BibleFieldLabel, BibleHeading } from "./settings-field";
import { type StoryPatch, useSaveStory } from "./use-save-story";

type Key = "instructions" | "voice" | keyof StudioStyle;

const STYLE_FIELDS: {
  key: keyof StudioStyle;
  label: string;
  hint?: string;
  placeholder: string;
}[] = [
  {
    key: "povAndTense",
    label: "POV and tense",
    placeholder: "First person, past tense, close to her",
  },
  {
    key: "register",
    label: "Register",
    placeholder: "Casual, warm, a little wry",
  },
  { key: "pacing", label: "Pacing", placeholder: "Fast; cut away early" },
  {
    key: "avoid",
    label: "Avoid",
    hint: "keep this short",
    placeholder: "Melodrama, purple prose",
  },
  {
    key: "notes",
    label: "Style notes",
    placeholder: "Anything else about voice",
  },
];

function parseSamples(raw: string): StudioVoiceSample[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StudioVoiceSample[]) : [];
  } catch {
    return [];
  }
}

export function InstructionsStyleSection() {
  const { state } = useStudioStore();
  const saveStory = useSaveStory();
  const { story } = state;

  const save = useCallback(
    async (changed: Partial<Record<Key, string>>, final: boolean) => {
      const trim = (value: string) => (final ? value.trim() : value);
      const patch: StoryPatch = {};
      if (changed.instructions !== undefined)
        patch.instructions = trim(changed.instructions);
      const style: Partial<StudioStyle> = {};
      for (const { key } of STYLE_FIELDS) {
        const value = changed[key];
        if (value !== undefined) style[key] = trim(value);
      }
      if (Object.keys(style).length > 0) patch.style = style;
      if (changed.voice !== undefined) {
        patch.voiceSamples = parseSamples(changed.voice).map((sample) =>
          final
            ? {
                ...sample,
                label: sample.label.trim(),
                text: sample.text.trim(),
              }
            : sample,
        );
      }
      return (await saveStory(patch)) !== null;
    },
    [saveStory],
  );

  const { flush, setValue, values } = useAutosaveFields<Key>({
    save,
    serverValues: {
      instructions: story.instructions,
      povAndTense: story.style.povAndTense,
      register: story.style.register,
      pacing: story.style.pacing,
      avoid: story.style.avoid,
      notes: story.style.notes,
      voice: JSON.stringify(story.voiceSamples),
    },
  });

  const samples = useMemo(() => parseSamples(values.voice), [values.voice]);
  const globalText = state.globalInstructions.trim();

  function setSamples(next: StudioVoiceSample[]) {
    setValue("voice", JSON.stringify(next));
  }

  function editSample(id: string, patch: Partial<StudioVoiceSample>) {
    setSamples(
      samples.map((sample) =>
        sample.id === id ? { ...sample, ...patch } : sample,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BibleHeading>Instructions &amp; Style</BibleHeading>
        <p className="text-body text-muted-foreground">
          The AI reads these in order: LocalInk instructions, then this story,
          then each chapter, scene and moment. The more specific note wins.
        </p>
      </div>

      <details className="rounded-md border border-border/70 bg-card/40 px-3 py-2">
        <summary className="cursor-pointer text-label-sm text-muted-foreground">
          LocalInk instructions (read-only here)
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {globalText ? (
            <p className="whitespace-pre-wrap text-label-sm">{globalText}</p>
          ) : (
            <p className="text-label-sm text-muted-foreground">
              No global instructions set.
            </p>
          )}
          <Link
            className="self-start text-caption text-primary underline-offset-4 hover:underline"
            href="/"
            rel="noreferrer"
            target="_blank"
          >
            edit in LocalInk settings
          </Link>
        </div>
      </details>

      <div className="flex flex-col gap-1.5">
        <BibleFieldLabel htmlFor="bible-instructions">
          Story instructions
        </BibleFieldLabel>
        <Textarea
          className="min-h-32"
          id="bible-instructions"
          maxLength={8000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("instructions", event.target.value)}
          placeholder="Anything the AI should follow for the whole story"
          value={values.instructions}
        />
      </div>

      <div className="flex flex-col gap-3">
        <BibleHeading>Style</BibleHeading>
        {STYLE_FIELDS.map((field) => (
          <div className="flex flex-col gap-1" key={field.key}>
            <BibleFieldLabel
              hint={field.hint}
              htmlFor={`bible-style-${field.key}`}
            >
              {field.label}
            </BibleFieldLabel>
            <Input
              id={`bible-style-${field.key}`}
              onBlur={() => void flush(true)}
              onChange={(event) => setValue(field.key, event.target.value)}
              placeholder={field.placeholder}
              value={values[field.key]}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <BibleHeading>Voice samples</BibleHeading>
          <span className="text-caption text-muted-foreground">
            {samples.length} of {STUDIO_MAX_VOICE_SAMPLES}
          </span>
        </div>
        <p className="text-label-sm text-muted-foreground">
          Short passages in the voice you want. The AI matches their rhythm, not
          their content.
        </p>
        {samples.map((sample, index) => (
          <div
            className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-card/40 p-2"
            key={sample.id}
          >
            <div className="flex items-center gap-1">
              <Input
                aria-label={`Voice sample ${index + 1} label`}
                className="h-8"
                maxLength={80}
                onBlur={() => void flush(true)}
                onChange={(event) =>
                  editSample(sample.id, { label: event.target.value })
                }
                placeholder="Label, such as 'Opening of my last story'"
                value={sample.label}
              />
              <Button
                aria-label={`Remove voice sample ${index + 1}`}
                className="size-8 shrink-0"
                onClick={() => {
                  setSamples(samples.filter((s) => s.id !== sample.id));
                  void flush(true);
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
            <Textarea
              aria-label={`Voice sample ${index + 1} text`}
              className="min-h-24 font-content"
              maxLength={STUDIO_MAX_VOICE_SAMPLE_CHARS}
              onBlur={() => void flush(true)}
              onChange={(event) =>
                editSample(sample.id, { text: event.target.value })
              }
              value={sample.text}
            />
          </div>
        ))}
        <Button
          className="self-start"
          disabled={samples.length >= STUDIO_MAX_VOICE_SAMPLES}
          onClick={() =>
            setSamples([
              ...samples,
              { id: generateId("studio-voice"), label: "", text: "" },
            ])
          }
          size="sm"
          type="button"
          variant="outline"
        >
          + add voice sample
        </Button>
      </div>
    </div>
  );
}
