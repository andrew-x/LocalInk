"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Textarea } from "@/components/common/textarea";
import { StudioConfirmDialog } from "@/components/studio/confirm-dialog";
import { InspectPill } from "@/components/studio/inspect/inspect-section";
import { useAutosaveFields } from "@/components/studio/inspect/use-autosave-fields";
import { useStudioStore } from "@/components/studio/workspace/use-studio-store";
import { STUDIO_ENTRY_SUGGESTIONS } from "@/lib/studio/bible-templates";
import type { StudioEntryDto } from "@/lib/studio/contracts";
import { getOrderedMoments } from "@/lib/studio/plan-order";

import { EntryFieldGroup } from "./entry-fields";
import { OverTheStory } from "./over-the-story";
import { RelationshipEditor } from "./relationship-editor";
import { useDeleteEntry } from "./use-delete-entry";
import { type EntryPatch, usePatchEntry } from "./use-patch-entry";

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
  const template = STUDIO_ENTRY_SUGGESTIONS[entry.type];

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
      const fieldEdits = new Map<string, string>();
      for (const [key, value] of Object.entries(changed)) {
        if (key.startsWith(FIELD_PREFIX) && value !== undefined)
          fieldEdits.set(key.slice(FIELD_PREFIX.length), value);
      }
      if (fieldEdits.size > 0) {
        // Rebuild the full list from the newest saved entry.
        const saved = await patchEntry(entry.id, (latest) => ({
          ...patch,
          fields: latest.fields.map((field) => {
            const value = fieldEdits.get(field.id);
            return value === undefined ? field : { ...field, value };
          }),
        }));
        if (saved === null) return false;
        return keep.length > 0 ? keep : true;
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
    for (const field of entry.fields) {
      values[`${FIELD_PREFIX}${field.id}`] = field.value;
    }
    return values;
  }, [entry.fields, entry.name, entry.summary]);

  const { flush, setValue, values } = useAutosaveFields<string>({
    save,
    serverValues,
  });

  const fieldValues = useMemo(() => {
    const result: Record<string, string> = {};
    for (const field of entry.fields) {
      result[field.id] = values[`${FIELD_PREFIX}${field.id}`] ?? field.value;
    }
    return result;
  }, [entry.fields, values]);

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

      {entry.fields.length > 0 ? (
        <EntryFieldGroup
          entryId={entry.id}
          fields={entry.fields}
          onBlur={() => void flush(true)}
          onChange={(fieldId, value) =>
            setValue(`${FIELD_PREFIX}${fieldId}`, value)
          }
          title="Details"
          values={fieldValues}
        />
      ) : null}

      <OverTheStory entry={entry} />

      <StudioConfirmDialog
        confirmLabel="Delete entry"
        description="This also deletes every change tracked for it over the story, and removes it from the moments it appears in. This cannot be undone."
        destructive
        loading={isDeleting}
        onConfirm={() => void confirmDelete()}
        onOpenChange={setConfirmingDelete}
        open={confirmingDelete}
        title={`Delete ${entry.name}?`}
      />
    </div>
  );
}
