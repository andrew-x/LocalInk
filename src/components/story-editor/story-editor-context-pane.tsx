"use client";

import { Brush, Plus, Save, UsersRound } from "lucide-react";
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

import type { StoryContext, StoryEditorData } from "@/actions/stories/_types";
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
  characters: StoryCharacter[];
  isOpen: boolean;
  onContextSaved: (context: StoryContextSave) => void;
  onToggleOpen: () => void;
  story: StoryIdentity;
  style: string;
};

export function StoryEditorContextPane({
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
        </div>
      ) : null}
    </aside>
  );
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
  const nameFieldId = useId();
  const descriptionFieldId = useId();

  useEffect(() => {
    if (!isOpen) {
      setDraftName(character?.name ?? "");
      setDraftDescription(character?.description ?? "");
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
          className="grid gap-4 p-4"
          onSubmit={handleSaveCharacter}
        >
          <div className="grid gap-2">
            <Label htmlFor={nameFieldId}>Name</Label>
            <Input
              aria-describedby={nameError ? `${nameFieldId}-error` : undefined}
              aria-invalid={!!nameError || undefined}
              autoComplete="off"
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
            <Label htmlFor={descriptionFieldId}>Description</Label>
            <Textarea
              aria-describedby={
                descriptionError ? `${descriptionFieldId}-error` : undefined
              }
              aria-invalid={!!descriptionError || undefined}
              className="min-h-36 resize-none"
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
