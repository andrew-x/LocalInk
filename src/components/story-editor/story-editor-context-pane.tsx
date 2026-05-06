"use client";

import {
  Brush,
  ChevronDown,
  FileText,
  Plus,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  type ComponentPropsWithoutRef,
  type FormEvent,
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { toast } from "sonner";

import type {
  StoryChapterItem,
  StoryContext,
  StoryEditorData,
} from "@/actions/stories/_types";
import { updateStory } from "@/actions/stories/update-story";
import { Button } from "@/components/common/button";
import { Input } from "@/components/common/input";
import { Label } from "@/components/common/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { Textarea } from "@/components/common/textarea";
import { StoryEditorPaneHeader } from "@/components/story-editor/story-editor-pane-header";
import { cn } from "@/lib/util";

type StoryCharacter = StoryContext["characters"][number];
type StoryCharacterDraft = Pick<StoryCharacter, "description" | "name"> &
  Partial<Pick<StoryCharacter, "id">>;
type StoryIdentity = Pick<StoryEditorData, "description" | "id" | "name">;
type StoryContextSave = StoryContext & { updatedAt: string };

type StoryEditorContextPaneProps = {
  chapters: StoryChapterItem[];
  characters: StoryCharacter[];
  isOpen: boolean;
  onContextSaved: (context: StoryContextSave) => void;
  onToggleOpen: () => void;
  story: StoryIdentity;
  style: string;
};

export function StoryEditorContextPane({
  chapters,
  characters,
  isOpen,
  onContextSaved,
  onToggleOpen,
  story,
  style,
}: StoryEditorContextPaneProps) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border/80 border-b bg-sidebar/70 lg:border-r lg:border-b-0">
      <StoryEditorPaneHeader
        isOpen={isOpen}
        label="Context"
        onToggle={onToggleOpen}
        side="left"
      />

      {isOpen ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="flex min-h-full flex-col">
            <div className="grid gap-3">
              <StyleContextSection
                characters={characters}
                onSaved={onContextSaved}
                story={story}
                style={style}
              />
              <CharacterContextSection
                characters={characters}
                onSaved={onContextSaved}
                story={story}
                style={style}
              />
            </div>

            <div className="mt-auto pt-3">
              <InspectContextSection chapters={chapters} />
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

type InspectContextSectionProps = {
  chapters: StoryChapterItem[];
};

function InspectContextSection({ chapters }: InspectContextSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const hasChapters = chapters.length > 0;

  return (
    <section className="rounded-md border border-border/70 bg-card/45 p-3">
      <button
        aria-controls={contentId}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 text-left text-label transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileText aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">Inspect</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen ? (
        <div className="mt-3 max-h-80 overflow-auto pr-1" id={contentId}>
          {hasChapters ? (
            <ul className="grid gap-2">
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <ChapterInspectPopover chapter={chapter} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-body text-muted-foreground">
              No chapters yet
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

type ChapterInspectPopoverProps = {
  chapter: StoryChapterItem;
};

function ChapterInspectPopover({ chapter }: ChapterInspectPopoverProps) {
  const summary = chapter.summary.trim();
  const chunks = chapter.chunks;
  const hasSummary = summary.length > 0;
  const hasChunks = chunks.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Inspect ${chapter.name}`}
          className="w-full rounded-md border border-border/70 bg-background/55 px-3 py-2.5 text-left transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:border-ring/60 data-[state=open]:bg-muted"
          type="button"
        >
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-label-sm text-foreground">
              {chapter.name}
            </span>
            <span className="shrink-0 text-caption text-muted-foreground">
              {getChunkCountLabel(chunks.length)}
            </span>
          </span>
          <span
            className={cn(
              "mt-1 block text-caption leading-5",
              hasSummary
                ? "line-clamp-3 whitespace-pre-line text-muted-foreground"
                : "text-muted-foreground/70",
            )}
          >
            {hasSummary ? summary : "No summary extracted yet"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[calc(100vh-2rem)] w-[40rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        collisionPadding={12}
        side="right"
      >
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <div className="border-border/70 border-b p-4">
            <h3 className="truncate text-label text-popover-foreground">
              {chapter.name}
            </h3>
            <p className="mt-1 text-caption text-muted-foreground">
              Chapter {chapter.position} - {getChunkCountLabel(chunks.length)}
            </p>
          </div>

          <div className="min-h-0 overflow-auto p-4">
            <section>
              <h4 className="text-label-sm text-popover-foreground">Summary</h4>
              <p
                className={cn(
                  "mt-2 whitespace-pre-line text-body leading-6",
                  hasSummary
                    ? "text-popover-foreground/90"
                    : "text-muted-foreground",
                )}
              >
                {hasSummary ? summary : "No summary extracted yet."}
              </p>
            </section>

            <section className="mt-5">
              <h4 className="text-label-sm text-popover-foreground">
                Extracted chunks
              </h4>

              {hasChunks ? (
                <ol className="mt-2 grid gap-3">
                  {chunks.map((chunk, index) => (
                    <li
                      className="rounded-md border border-border/60 bg-background/45 p-3"
                      key={chunk.id}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2 text-caption text-muted-foreground">
                        <span>Chunk {index + 1}</span>
                        <span className="shrink-0">
                          {chunk.startPosition}-{chunk.endPosition}
                        </span>
                      </div>
                      <p className="whitespace-pre-line font-content text-body leading-6 text-popover-foreground/90">
                        {chunk.text}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-body text-muted-foreground">
                  No chunks extracted yet.
                </p>
              )}
            </section>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function getChunkCountLabel(chunkCount: number) {
  if (chunkCount === 1) {
    return "1 chunk";
  }

  return `${chunkCount} chunks`;
}

type StyleContextSectionProps = {
  characters: StoryCharacter[];
  onSaved: (context: StoryContextSave) => void;
  story: StoryIdentity;
  style: string;
};

function StyleContextSection({
  characters,
  onSaved,
  story,
  style,
}: StyleContextSectionProps) {
  const updateStoryAction = useAction(updateStory);
  const [isOpen, setIsOpen] = useState(false);
  const [draftStyle, setDraftStyle] = useState(style);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const styleFieldId = useId();
  const hasStyle = style.trim().length > 0;

  useEffect(() => {
    if (!isOpen) {
      setDraftStyle(style);
    }
  }, [isOpen, style]);

  function handleOpenChange(open: boolean) {
    if (updateStoryAction.isPending) {
      return;
    }

    setIsOpen(open);
    setFieldError(null);
    setRootError(null);

    if (open) {
      setDraftStyle(style);
    }
  }

  async function handleSaveStyle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setRootError(null);

    const nextStyle = draftStyle.trim();

    if (nextStyle.length > 4000) {
      setFieldError("Style must be 4000 characters or fewer.");
      return;
    }

    const result = await updateStoryAction.executeAsync({
      characters,
      description: story.description,
      id: story.id,
      name: story.name,
      style: nextStyle,
    });

    if (result.data) {
      onSaved({
        characters: result.data.characters,
        style: result.data.style,
        updatedAt: result.data.updatedAt,
      });
      setIsOpen(false);
      return;
    }

    const message = getUpdateFailureMessage(
      result,
      "The style could not be saved.",
    );
    setRootError(message);
    toast.error(message);
  }

  return (
    <section className="rounded-md border border-border/70 bg-card/45 p-3">
      <h2 className="flex items-center gap-2 text-label">
        <Brush aria-hidden="true" className="size-3.5" />
        Style
      </h2>

      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className="mt-3 w-full rounded-md border border-border/70 bg-background/55 px-3 py-2.5 text-left transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:border-ring/60 data-[state=open]:bg-muted"
            type="button"
          >
            <span
              className={cn(
                "block text-body leading-5",
                hasStyle
                  ? "line-clamp-3 whitespace-pre-line"
                  : "text-muted-foreground",
              )}
            >
              {hasStyle ? style.trim() : "Add a style description"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-96 max-w-[calc(100vw-2rem)] p-0"
          collisionPadding={12}
          side="right"
        >
          <form
            autoComplete="off"
            className="grid gap-4 p-4"
            onSubmit={handleSaveStyle}
          >
            <div className="grid gap-2">
              <Label htmlFor={styleFieldId}>Style description</Label>
              <Textarea
                aria-describedby={
                  fieldError ? `${styleFieldId}-error` : undefined
                }
                aria-invalid={!!fieldError || undefined}
                className="min-h-44 resize-none"
                id={styleFieldId}
                maxLength={4000}
                onChange={(event) => setDraftStyle(event.target.value)}
                value={draftStyle}
              />
              {fieldError ? (
                <p
                  className="text-caption text-destructive"
                  id={`${styleFieldId}-error`}
                >
                  {fieldError}
                </p>
              ) : null}
            </div>

            {rootError ? <ContextFormError message={rootError} /> : null}

            <div className="flex justify-end gap-2">
              <Button
                disabled={updateStoryAction.isPending}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                leftSection={<Save aria-hidden="true" />}
                loading={updateStoryAction.isPending}
                type="submit"
              >
                Save
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </section>
  );
}

type CharacterContextSectionProps = {
  characters: StoryCharacter[];
  onSaved: (context: StoryContextSave) => void;
  story: StoryIdentity;
  style: string;
};

function CharacterContextSection({
  characters,
  onSaved,
  story,
  style,
}: CharacterContextSectionProps) {
  const hasCharacters = characters.length > 0;

  return (
    <section className="rounded-md border border-border/70 bg-card/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-label">
          <UsersRound aria-hidden="true" className="size-3.5" />
          Characters
        </h2>

        {hasCharacters ? (
          <CharacterPopover
            characters={characters}
            mode="create"
            onSaved={onSaved}
            story={story}
            style={style}
            trigger={
              <button
                aria-label="Add character"
                className="-my-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:bg-muted data-[state=open]:text-foreground"
                title="Add character"
                type="button"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            }
          />
        ) : null}
      </div>

      {hasCharacters ? (
        <ul className="mt-3 grid gap-2">
          {characters.map((character, index) => (
            <li key={character.id}>
              <CharacterPopover
                character={character}
                characterIndex={index}
                characters={characters}
                mode="edit"
                onSaved={onSaved}
                story={story}
                style={style}
                trigger={<CharacterWidget character={character} />}
              />
            </li>
          ))}
        </ul>
      ) : (
        <CharacterPopover
          characters={characters}
          mode="create"
          onSaved={onSaved}
          story={story}
          style={style}
          trigger={
            <button
              className="mt-3 w-full rounded-md border border-dashed border-border/70 px-3 py-8 text-center text-body text-muted-foreground transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted/60 hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:border-ring/60 data-[state=open]:bg-muted data-[state=open]:text-foreground"
              type="button"
            >
              Add a character
            </button>
          }
        />
      )}
    </section>
  );
}

type CharacterWidgetProps = ComponentPropsWithoutRef<"button"> & {
  character: StoryCharacter;
};

const CharacterWidget = forwardRef<HTMLButtonElement, CharacterWidgetProps>(
  ({ character, className, type = "button", ...props }, ref) => {
    const description = character.description.trim();

    return (
      <button
        className={cn(
          "w-full rounded-md border border-border/70 bg-background/55 px-3 py-2.5 text-left transition-[background-color,border-color,color] hover:border-ring/50 hover:bg-muted/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none data-[state=open]:border-ring/60 data-[state=open]:bg-muted",
          className,
        )}
        ref={ref}
        type={type}
        {...props}
      >
        <span className="block truncate text-label-sm text-foreground">
          {character.name}
        </span>
        <span
          className={cn(
            "mt-1 block text-body leading-5",
            description
              ? "line-clamp-3 whitespace-pre-line text-muted-foreground"
              : "text-muted-foreground/70",
          )}
        >
          {description || "Add a description"}
        </span>
      </button>
    );
  },
);
CharacterWidget.displayName = "CharacterWidget";

type CharacterPopoverProps = {
  character?: StoryCharacter;
  characterIndex?: number;
  characters: StoryCharacter[];
  mode: "create" | "edit";
  onSaved: (context: StoryContextSave) => void;
  story: StoryIdentity;
  style: string;
  trigger: ReactNode;
};

function CharacterPopover({
  character,
  characterIndex,
  characters,
  mode,
  onSaved,
  story,
  style,
  trigger,
}: CharacterPopoverProps) {
  const updateStoryAction = useAction(updateStory);
  const [isOpen, setIsOpen] = useState(false);
  const [draftName, setDraftName] = useState(character?.name ?? "");
  const [draftDescription, setDraftDescription] = useState(
    character?.description ?? "",
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const nameFieldId = useId();
  const descriptionFieldId = useId();

  useEffect(() => {
    if (!isOpen) {
      setDraftName(character?.name ?? "");
      setDraftDescription(character?.description ?? "");
      setIsConfirmingDelete(false);
    }
  }, [character?.description, character?.name, isOpen]);

  function resetErrors() {
    setNameError(null);
    setDescriptionError(null);
    setRootError(null);
  }

  function handleOpenChange(open: boolean) {
    if (updateStoryAction.isPending) {
      return;
    }

    setIsOpen(open);
    resetErrors();
    setIsConfirmingDelete(false);

    if (open) {
      setDraftName(character?.name ?? "");
      setDraftDescription(character?.description ?? "");
    }
  }

  async function handleSaveCharacter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetErrors();

    const nextCharacter = {
      description: draftDescription.trim(),
      id: character?.id,
      name: draftName.trim(),
    };

    const hasValidationError = validateCharacter(
      nextCharacter,
      setNameError,
      setDescriptionError,
    );

    if (hasValidationError) {
      return;
    }

    const nextCharacters =
      mode === "create"
        ? [...characters, nextCharacter]
        : characters.map((currentCharacter, index) =>
            index === characterIndex ? nextCharacter : currentCharacter,
          );

    const result = await updateStoryAction.executeAsync({
      characters: nextCharacters,
      description: story.description,
      id: story.id,
      name: story.name,
      style,
    });

    if (result.data) {
      onSaved({
        characters: result.data.characters,
        style: result.data.style,
        updatedAt: result.data.updatedAt,
      });
      setIsOpen(false);
      return;
    }

    const message = getUpdateFailureMessage(
      result,
      mode === "create"
        ? "The character could not be added."
        : "The character could not be saved.",
    );
    setRootError(message);
    toast.error(message);
  }

  async function handleDeleteCharacter() {
    if (mode !== "edit" || characterIndex === undefined) {
      return;
    }

    resetErrors();

    const nextCharacters = characters.filter(
      (_, index) => index !== characterIndex,
    );

    const result = await updateStoryAction.executeAsync({
      characters: nextCharacters,
      description: story.description,
      id: story.id,
      name: story.name,
      style,
    });

    if (result.data) {
      onSaved({
        characters: result.data.characters,
        style: result.data.style,
        updatedAt: result.data.updatedAt,
      });
      setIsOpen(false);
      return;
    }

    const message = getUpdateFailureMessage(
      result,
      "The character could not be deleted.",
    );
    setRootError(message);
    setIsConfirmingDelete(true);
    toast.error(message);
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-96 max-w-[calc(100vw-2rem)] p-0"
        collisionPadding={12}
        side="right"
      >
        <form
          autoComplete="off"
          className="grid gap-3 p-3"
          onSubmit={handleSaveCharacter}
        >
          <div className="grid gap-2">
            <Label className="text-label-sm" htmlFor={nameFieldId}>
              Name
            </Label>
            <Input
              aria-describedby={nameError ? `${nameFieldId}-error` : undefined}
              aria-invalid={!!nameError || undefined}
              autoComplete="off"
              className="h-8 px-2 text-caption"
              id={nameFieldId}
              maxLength={120}
              onChange={(event) => setDraftName(event.target.value)}
              spellCheck={false}
              value={draftName}
            />
            {nameError ? (
              <p
                className="text-caption text-destructive"
                id={`${nameFieldId}-error`}
              >
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label className="text-label-sm" htmlFor={descriptionFieldId}>
              Description
            </Label>
            <Textarea
              aria-describedby={
                descriptionError ? `${descriptionFieldId}-error` : undefined
              }
              aria-invalid={!!descriptionError || undefined}
              className="min-h-32 resize-none px-2 py-1.5 text-caption leading-5"
              id={descriptionFieldId}
              maxLength={1000}
              onChange={(event) => setDraftDescription(event.target.value)}
              value={draftDescription}
            />
            {descriptionError ? (
              <p
                className="text-caption text-destructive"
                id={`${descriptionFieldId}-error`}
              >
                {descriptionError}
              </p>
            ) : null}
          </div>

          {rootError ? <ContextFormError message={rootError} /> : null}

          {isConfirmingDelete ? (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
              role="alert"
            >
              <p className="text-label-sm text-destructive">
                Delete this character?
              </p>
              <p className="mt-1 text-caption text-destructive/90">
                This will remove {character?.name ?? "this character"} from the
                story context.
              </p>
            </div>
          ) : null}

          {isConfirmingDelete ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <Button
                className="justify-self-start text-caption"
                leftSection={<Trash2 aria-hidden="true" />}
                loading={updateStoryAction.isPending}
                onClick={handleDeleteCharacter}
                size="sm"
                type="button"
                variant="destructive"
              >
                Delete
              </Button>
              <Button
                className="justify-self-start text-caption sm:justify-self-end"
                disabled={updateStoryAction.isPending}
                onClick={() => setIsConfirmingDelete(false)}
                size="sm"
                type="button"
                variant="outline"
              >
                Keep
              </Button>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-2 sm:items-center",
                mode === "edit" ? "sm:grid-cols-[1fr_auto]" : "sm:justify-end",
              )}
            >
              {mode === "edit" ? (
                <Button
                  className="justify-self-start text-caption"
                  disabled={updateStoryAction.isPending}
                  leftSection={<Trash2 aria-hidden="true" />}
                  onClick={() => {
                    resetErrors();
                    setIsConfirmingDelete(true);
                  }}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  Delete
                </Button>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  className="text-caption"
                  disabled={updateStoryAction.isPending}
                  onClick={() => handleOpenChange(false)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  className="text-caption"
                  leftSection={<Save aria-hidden="true" />}
                  loading={updateStoryAction.isPending}
                  size="sm"
                  type="submit"
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}

function validateCharacter(
  character: StoryCharacterDraft,
  setNameError: (message: string) => void,
  setDescriptionError: (message: string) => void,
) {
  let hasError = false;

  if (!character.name) {
    setNameError("Character name is required.");
    hasError = true;
  } else if (character.name.length > 120) {
    setNameError("Character name must be 120 characters or fewer.");
    hasError = true;
  }

  if (character.description.length > 1000) {
    setDescriptionError(
      "Character description must be 1000 characters or fewer.",
    );
    hasError = true;
  }

  return hasError;
}

type UpdateFailureResult = {
  serverError?: {
    message?: string;
  };
  validationErrors?: {
    formErrors?: string[];
  };
};

function getUpdateFailureMessage(
  result: UpdateFailureResult,
  fallback: string,
) {
  return (
    result.validationErrors?.formErrors?.[0] ??
    result.serverError?.message ??
    fallback
  );
}

function ContextFormError({ message }: { message: string }) {
  return (
    <p
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-body text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}
