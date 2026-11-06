"use client";

import { LoaderCircle } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { applyStudioCast } from "@/actions/studio/apply-studio-cast";
import { getStudioWorkspace } from "@/actions/studio/get-studio-workspace";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import { Textarea } from "@/components/common/textarea";
import { EntryCard } from "@/components/studio/characters/entry-card";
import { waitForEntrySaves } from "@/components/studio/characters/use-patch-entry";
import {
  postStudioJson,
  studioErrorMessage,
} from "@/components/studio/studio-fetch";
import {
  StudioStoreProvider,
  useRunStudioAction,
  useStudioStore,
} from "@/components/studio/workspace/use-studio-store";
import { formResolver } from "@/lib/schemas/resolve";
import {
  STUDIO_CAST_NOTE_MAX_CHARS,
  STUDIO_CAST_TYPES,
  type StudioCastApplyResult,
  type StudioCastPreview,
  type StudioCastRequest,
  type StudioCastType,
} from "@/lib/studio/cast-contract";
import type { StudioWorkspace } from "@/lib/studio/contracts";

import { CastTuning, type CastTuningState } from "./cast-tuning";
import type { QuestionAnswer } from "./questions-step";

/** Cast-step state the flow keeps, so going back and forth costs no calls. */
export type CastFlowState = {
  /** The cast was drafted once already; an empty cast is not redrafted. */
  drafted: boolean;
  tuning: Record<string, CastTuningState>;
};

export const EMPTY_CAST_FLOW_STATE: CastFlowState = {
  drafted: false,
  tuning: {},
};

type CastStepProps = {
  answers: QuestionAnswer[];
  castState: CastFlowState;
  onBack: () => void;
  onCastStateChange: (update: (state: CastFlowState) => CastFlowState) => void;
  onContinue: () => void;
  storyId: string;
  title: string;
};

const LOAD_FAILED_MESSAGE = "The story could not be loaded.";

export function CastStep(props: CastStepProps) {
  const { storyId } = props;
  const [workspace, setWorkspace] = useState<StudioWorkspace | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load when the author retries.
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    getStudioWorkspace(storyId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) throw new Error("missing");
        setWorkspace(loaded);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error(LOAD_FAILED_MESSAGE);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storyId, attempt]);

  if (!workspace) {
    return (
      <CastShell title={props.title}>
        {failed ? (
          <div className="grid justify-items-center gap-4 rounded-lg border border-border/80 bg-card/45 px-panel py-8 text-center">
            <p className="text-body text-muted-foreground">
              {LOAD_FAILED_MESSAGE}
            </p>
            <div className="flex gap-2">
              <Button onClick={props.onBack} variant="outline">
                Back to questions
              </Button>
              <Button onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <Waiting text="Opening your story…" />
        )}
      </CastShell>
    );
  }

  return (
    <StudioStoreProvider initial={workspace}>
      <CastEditor {...props} />
    </StudioStoreProvider>
  );
}

function CastShell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-serif text-title">People and places</h1>
        <p className="mt-1 text-body text-muted-foreground">
          The people and places from your brain dump for {title}. Shape them
          now: the plan is built around them.
        </p>
      </div>
      {children}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <div
      aria-live="polite"
      className="grid justify-items-center gap-3 rounded-lg border border-border/80 bg-card/45 px-panel py-10 text-center text-body text-muted-foreground"
    >
      <LoaderCircle aria-hidden="true" className="size-6 animate-spin" />
      {text}
    </div>
  );
}

const DRAFT_FAILED_MESSAGE = "Your people and places could not be drafted.";
const SAVE_FAILED_MESSAGE = "Your people and places could not be saved.";

const SECTION_COPY: Record<
  StudioCastType,
  { heading: string; empty: string; add: string; failedAdd: string }
> = {
  character: {
    heading: "People",
    empty: "No one from your brain dump yet.",
    add: "+ Add someone",
    failedAdd: "The character could not be added.",
  },
  place: {
    heading: "Places",
    empty: "No places from your brain dump yet.",
    add: "+ Add a place",
    failedAdd: "The place could not be added.",
  },
};

function CastEditor({
  answers,
  castState,
  onBack,
  onCastStateChange,
  onContinue,
  storyId,
  title,
}: CastStepProps) {
  const { state, dispatch } = useStudioStore();
  const run = useRunStudioAction();
  const [drafting, setDrafting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [continuing, setContinuing] = useState(false);
  const started = useRef(false);

  const byType = useMemo(() => {
    const of = (type: StudioCastType) =>
      state.entries
        .filter((entry) => entry.type === type)
        .sort((a, b) => a.position - b.position);
    return { character: of("character"), place: of("place") };
  }, [state.entries]);
  const castSize = byType.character.length + byType.place.length;

  /** Generates (draft or add), saves, and merges the new entries. */
  const generate = useCallback(
    async (request: StudioCastRequest): Promise<string | null> => {
      try {
        const preview = await postStudioJson<StudioCastPreview>(
          "/api/studio/cast",
          request,
        );
        const saved = await run<StudioCastApplyResult>(
          applyStudioCast({
            storyId,
            generationId: preview.generationId,
            mode: request.mode,
          }),
          SAVE_FAILED_MESSAGE,
        );
        if (!saved) return SAVE_FAILED_MESSAGE;
        dispatch({ type: "merge", entries: saved.entries });
        onCastStateChange((current) => {
          const tuning = { ...current.tuning };
          for (const [entryId, picks] of Object.entries(saved.picks)) {
            tuning[entryId] = {
              picks,
              asked: picks.map((pick) => pick.question),
            };
          }
          return { drafted: true, tuning };
        });
        return null;
      } catch (error) {
        const message = studioErrorMessage(
          error,
          request.mode === "draft"
            ? DRAFT_FAILED_MESSAGE
            : SECTION_COPY[request.type].failedAdd,
        );
        toast.error(message);
        return message;
      }
    },
    [dispatch, onCastStateChange, run, storyId],
  );

  const draft = useCallback(async () => {
    setDrafting(true);
    setDraftFailed(false);
    const failed = await generate({ mode: "draft", storyId, answers });
    setDrafting(false);
    if (failed) setDraftFailed(true);
  }, [answers, generate, storyId]);

  // Drafts once per flow, and never over people or places that already exist
  // (a resumed story, or a return from the questions).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (castState.drafted || castSize > 0) return;
    void draft();
  }, [castSize, castState.drafted, draft]);

  const setBusy = useCallback((entryId: string, busy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  }, []);

  async function continueToPlan() {
    setContinuing(true);
    try {
      // Edits flushed by the click's blur must land before the plan reads them.
      await Promise.all(
        [...byType.character, ...byType.place].map((entry) =>
          waitForEntrySaves(storyId, entry.id),
        ),
      );
      onContinue();
    } finally {
      setContinuing(false);
    }
  }

  async function add(
    type: StudioCastType,
    name: string,
    note: string,
  ): Promise<string | null> {
    setAdding(true);
    try {
      return await generate({
        mode: "add",
        storyId,
        answers,
        type,
        name,
        note,
      });
    } finally {
      setAdding(false);
    }
  }

  // Leaving or planning mid-generation would save entries this step (or the
  // plan) never sees, so both wait for every running call.
  const busy = drafting || adding || busyIds.size > 0;

  return (
    <CastShell title={title}>
      {drafting ? (
        <Waiting text="Reading your brain dump for the people and places in it…" />
      ) : (
        <>
          {draftFailed && castSize === 0 ? (
            <div className="grid justify-items-center gap-4 rounded-lg border border-border/80 bg-card/45 px-panel py-8 text-center">
              <p className="text-body text-muted-foreground">
                Your people and places could not be drafted. You can try again,
                add them yourself, or plan without them.
              </p>
              <Button onClick={() => void draft()} variant="outline">
                Try again
              </Button>
            </div>
          ) : castSize === 0 ? (
            <div className="grid justify-items-center gap-3 rounded-lg border border-border/80 bg-card/45 px-panel py-8 text-center">
              <p className="text-body text-muted-foreground">
                Nothing from your brain dump yet. Add the people and places your
                story is about, or plan without them.
              </p>
              <Button onClick={() => void draft()} size="sm" variant="ghost">
                Look again
              </Button>
            </div>
          ) : null}

          {STUDIO_CAST_TYPES.map((type) => (
            <section
              aria-label={SECTION_COPY[type].heading}
              className="grid gap-3"
              key={type}
            >
              <h2 className="font-serif text-heading">
                {SECTION_COPY[type].heading}
              </h2>
              {byType[type].length === 0 && castSize > 0 ? (
                <p className="text-body text-muted-foreground">
                  {SECTION_COPY[type].empty}
                </p>
              ) : null}
              {byType[type].map((entry) => (
                <EntryCard
                  entry={entry}
                  key={entry.id}
                  onDeleted={() =>
                    onCastStateChange((current) => {
                      const { [entry.id]: _removed, ...tuning } =
                        current.tuning;
                      return { ...current, tuning };
                    })
                  }
                  variant="cast"
                >
                  <CastTuning
                    entry={entry}
                    onBusyChange={(value) => setBusy(entry.id, value)}
                    onTuningChange={(tuning) =>
                      onCastStateChange((current) => ({
                        ...current,
                        tuning: { ...current.tuning, [entry.id]: tuning },
                      }))
                    }
                    tuning={
                      castState.tuning[entry.id] ?? { picks: [], asked: [] }
                    }
                  />
                </EntryCard>
              ))}
              <AddEntryForm
                disabled={busy}
                onAdd={(name, note) => add(type, name, note)}
                type={type}
              />
            </section>
          ))}
        </>
      )}

      <div className="flex justify-end gap-2">
        <Button
          disabled={busy}
          onClick={onBack}
          type="button"
          variant="outline"
        >
          Back to questions
        </Button>
        <Button
          disabled={busy}
          loading={continuing}
          onClick={() => void continueToPlan()}
          type="button"
        >
          {castSize > 0 ? "Plan the story" : "Plan without them"}
        </Button>
      </div>
    </CastShell>
  );
}

const FORM_COPY: Record<
  StudioCastType,
  { nameError: string; noteLabel: string; placeholder: string; submit: string }
> = {
  character: {
    nameError: "Give them a name.",
    noteLabel: "Who are they? (optional)",
    placeholder:
      "Her older brother, back from the army and pretending he's fine.",
    submit: "Add to the story",
  },
  place: {
    nameError: "Give it a name.",
    noteLabel: "What is it? (optional)",
    placeholder: "The all-night laundromat where she does her homework.",
    submit: "Add to the story",
  },
};

function addFormSchema(type: StudioCastType) {
  return z.object({
    name: z.string().trim().min(1, FORM_COPY[type].nameError).max(200),
    note: z
      .string()
      .trim()
      .max(
        STUDIO_CAST_NOTE_MAX_CHARS,
        `Keep the note to ${STUDIO_CAST_NOTE_MAX_CHARS.toLocaleString()} characters or fewer.`,
      ),
  });
}

type AddFormValues = z.infer<ReturnType<typeof addFormSchema>>;

function AddEntryForm({
  disabled,
  onAdd,
  type,
}: {
  disabled: boolean;
  onAdd: (name: string, note: string) => Promise<string | null>;
  type: StudioCastType;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<AddFormValues>({
    defaultValues: { name: "", note: "" },
    resolver: formResolver(addFormSchema(type)),
  });
  const { errors, isSubmitting } = form.formState;
  const copy = FORM_COPY[type];
  const idPrefix = `cast-add-${type}`;

  async function submit(values: AddFormValues) {
    form.clearErrors("root");
    const failed = await onAdd(values.name, values.note);
    if (failed) {
      form.setError("root", { message: failed });
      return;
    }
    form.reset({ name: "", note: "" });
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        className="justify-self-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        {SECTION_COPY[type].add}
      </Button>
    );
  }

  const nameError = errors.name?.message;
  const noteError = errors.note?.message ?? errors.root?.message;

  return (
    <form
      className="grid gap-3 rounded-lg border border-border/80 bg-card/45 p-4"
      onSubmit={form.handleSubmit(submit, () =>
        toast.error("Check the highlighted fields and try again."),
      )}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          {...form.register("name")}
          aria-describedby={nameError ? `${idPrefix}-name-error` : undefined}
          aria-invalid={Boolean(nameError) || undefined}
          autoComplete="off"
          autoFocus
          id={`${idPrefix}-name`}
          maxLength={200}
        />
        {nameError ? (
          <p
            className="text-caption text-destructive"
            id={`${idPrefix}-name-error`}
          >
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-note`}>{copy.noteLabel}</Label>
        <Textarea
          {...form.register("note")}
          aria-describedby={noteError ? `${idPrefix}-note-error` : undefined}
          aria-invalid={Boolean(errors.note) || undefined}
          autoComplete="off"
          className="min-h-20 font-content"
          id={`${idPrefix}-note`}
          maxLength={STUDIO_CAST_NOTE_MAX_CHARS}
          placeholder={copy.placeholder}
        />
        {noteError ? (
          <p
            className="text-caption text-destructive"
            id={`${idPrefix}-note-error`}
          >
            {noteError}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          disabled={isSubmitting}
          onClick={() => {
            form.reset({ name: "", note: "" });
            setOpen(false);
          }}
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={disabled} loading={isSubmitting} type="submit">
          {copy.submit}
        </Button>
      </div>
    </form>
  );
}
