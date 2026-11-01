"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/common/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/common/dialog";
import { Input } from "@/components/common/input";
import { Textarea } from "@/components/common/textarea";
import { InspectPill } from "@/components/studio/inspect/inspect-section";
import { useAutosaveFields } from "@/components/studio/inspect/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { STUDIO_ENTRY_TEMPLATES } from "@/lib/studio/bible-templates";
import type { StudioEntryDto, StudioEntryType } from "@/lib/studio/contracts";
import { getOrderedMoments } from "@/lib/studio/plan-order";

import { EntryFieldGroup } from "./entry-fields";
import { OverTheStory } from "./over-the-story";
import {
  RelationshipEditor,
  relationshipFieldLabel,
  relationshipPair,
} from "./relationship-editor";
import { useDeleteEntry } from "./use-delete-entry";
import { type EntryPatch, usePatchEntry } from "./use-patch-entry";

const FIXED_TITLE: Record<StudioEntryType, string> = {
  character: "Who they are",
  relationship: "Between them",
  place: "The place",
  thing: "The thing",
  lore: "The rule",
  custom: "Details",
};

const FIELD_PREFIX = "field:";

type EntryEditorProps = {
  entry: StudioEntryDto;
  /** Focus and select the name, for an entry that was just created. */
  focusName?: boolean;
  onDeleted: () => void;
};

/**
 * Name, summary and template fields for one entry, then its changes over the
 * story. Mount it with `key={entry.id}` so drafts never cross entries.
 */
export function EntryEditor({ entry, focusName, onDeleted }: EntryEditorProps) {
  const { state } = useStudioStore();
  const patchEntry = usePatchEntry();
  const deleteEntry = useDeleteEntry();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const template = STUDIO_ENTRY_TEMPLATES[entry.type];

  const appearsIn = useMemo(
    () =>
      getOrderedMoments(state.planItems).filter((moment) =>
        moment.presentEntryIds.includes(entry.id),
      ).length,
    [entry.id, state.planItems],
  );

  const save = useCallback(
    async (changed: Partial<Record<string, string>>, final: boolean) => {
      const patch: EntryPatch = {};
      const keep: string[] = [];
      if (changed.name !== undefined) {
        const trimmed = changed.name.trim();
        // A blank name, or one still being typed, stays local until blur.
        if (!trimmed || (!final && trimmed !== changed.name)) keep.push("name");
        else patch.name = trimmed;
      }
      if (changed.summary !== undefined) patch.summary = changed.summary;
      for (const [key, value] of Object.entries(changed)) {
        if (!key.startsWith(FIELD_PREFIX) || value === undefined) continue;
        patch.fields ??= {};
        patch.fields[key.slice(FIELD_PREFIX.length)] = { value };
      }
      if (Object.keys(patch).length > 0) {
        if ((await patchEntry(entry.id, patch)) === null) return false;
      }
      return keep.length > 0 ? keep : true;
    },
    [entry.id, patchEntry],
  );

  const serverValues = useMemo(() => {
    const values: Record<string, string> = {
      name: entry.name,
      summary: entry.summary,
    };
    for (const field of template.fields) {
      values[`${FIELD_PREFIX}${field.key}`] =
        entry.fields[field.key]?.value ?? "";
    }
    return values;
  }, [entry.fields, entry.name, entry.summary, template.fields]);

  const { flush, setValue, values } = useAutosaveFields<string>({
    save,
    serverValues,
  });

  const fieldValues = useMemo(() => {
    const result: Record<string, string> = {};
    for (const field of template.fields) {
      result[field.key] = values[`${FIELD_PREFIX}${field.key}`] ?? "";
    }
    return result;
  }, [template.fields, values]);

  const pair = useMemo(
    () => relationshipPair(entry, state.entries),
    [entry, state.entries],
  );
  const labelFor =
    entry.type === "relationship"
      ? (field: (typeof template.fields)[number]) =>
          relationshipFieldLabel(field, pair)
      : undefined;

  const groups = [
    {
      title: `${FIXED_TITLE[entry.type]} · fixed`,
      fields: template.fields.filter((field) => field.group === "fixed"),
    },
    {
      title: "Voice",
      fields: template.fields.filter((field) => field.group === "voice"),
    },
  ].filter((group) => group.fields.length > 0);

  async function confirmDelete() {
    setIsDeleting(true);
    try {
      if (await deleteEntry(entry)) {
        setConfirmingDelete(false);
        onDeleted();
      }
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <Input
            aria-label="Name"
            autoFocus={focusName}
            className="h-10 font-serif text-title"
            maxLength={200}
            onBlur={() => void flush(true)}
            onChange={(event) => setValue("name", event.target.value)}
            onFocus={(event) => {
              if (focusName) event.currentTarget.select();
            }}
            value={values.name}
          />
          <Button
            aria-label={`Delete ${entry.name}`}
            className="size-10 shrink-0"
            onClick={() => setConfirmingDelete(true)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InspectPill>
            {entry.type === "custom"
              ? entry.customTypeLabel || template.label
              : template.label}
          </InspectPill>
          <span className="text-caption text-muted-foreground">
            appears in {appearsIn} {appearsIn === 1 ? "moment" : "moments"}
          </span>
        </div>
        <Textarea
          aria-label="Summary"
          className="min-h-16"
          maxLength={20_000}
          onBlur={() => void flush(true)}
          onChange={(event) => setValue("summary", event.target.value)}
          placeholder="One-line summary"
          value={values.summary}
        />
      </header>

      {entry.type === "relationship" ? (
        <RelationshipEditor entry={entry} />
      ) : null}

      {groups.map((group) => (
        <EntryFieldGroup
          entryId={entry.id}
          fields={group.fields}
          key={group.title}
          labelFor={labelFor}
          onBlur={() => void flush(true)}
          onChange={(key, value) => setValue(`${FIELD_PREFIX}${key}`, value)}
          title={group.title}
          values={fieldValues}
        />
      ))}

      <OverTheStory entry={entry} />

      <Dialog onOpenChange={setConfirmingDelete} open={confirmingDelete}>
        <DialogContent className="p-5" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete {entry.name}?</DialogTitle>
            <DialogDescription>
              This also deletes every change tracked for it over the story, and
              removes it from the moments it appears in. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setConfirmingDelete(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              loading={isDeleting}
              onClick={() => void confirmDelete()}
              type="button"
              variant="destructive"
            >
              Delete entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
