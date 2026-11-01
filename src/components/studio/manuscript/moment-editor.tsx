"use client";

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  type InitialConfigType,
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import type { EditorState } from "lexical";
import { memo, type ReactNode, useCallback, useMemo, useState } from "react";

import { createLogger } from "@/lib/logger";
import type { StudioProseDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import { STUDIO_UNBOUND_EDITOR_ID } from "./editor-registry";
import {
  EditablePlugin,
  ExternalProsePlugin,
  FocusTrackingPlugin,
  MomentHandlePlugin,
  MomentKeyboardPlugin,
  STUDIO_EXTERNAL_PROSE_TAG,
} from "./moment-editor-plugins";
import {
  STUDIO_EDITOR_THEME,
  STUDIO_PROSE_CLASS,
  STUDIO_SCENE_START_CLASS,
} from "./prose-styles";
import { SelectionToolbarPlugin } from "./selection-toolbar";
import { STUDIO_MARKDOWN_TRANSFORMERS } from "./studio-markdown";
import { useMomentAutosave } from "./use-moment-autosave";

const momentEditorLogger = createLogger("studio-moment-editor");

const STUDIO_MOMENT_TINT_CLASS =
  "bg-studio-moment-highlight shadow-[-2px_0_0_0_var(--color-studio-moment-edge)]";
const HOVER_TINT_CLASS =
  "hover:bg-studio-moment-highlight hover:shadow-[-2px_0_0_0_var(--color-studio-moment-edge)]";

type MomentEditorProps = {
  storyId: string;
  /** Null for a continue editor whose moment is created on first keystroke. */
  momentId: string | null;
  /** The plan title, used only for the accessible label. */
  title: string;
  prose: StudioProseDto | undefined;
  isSceneStart: boolean;
  isHighlighted: boolean;
  onFocusMoment: (momentId: string | null) => void;
  onBlurMoment: (momentId: string | null) => void;
  /** Continue mode: the quiet "Continue with …" line shown while empty. */
  continueLine?: ReactNode;
  placeholder?: string;
  createMoment?: () => Promise<string | null>;
  /** Blocks typing, e.g. while the continue target's moments are planned. */
  readOnly?: boolean;
};

/**
 * A minimal Lexical editor for one moment's prose. Moments stack with no
 * visible boundary; hover or a selected plan item tints the moment.
 */
export const MomentEditor = memo(function MomentEditor({
  continueLine,
  createMoment,
  isHighlighted,
  isSceneStart,
  momentId,
  onBlurMoment,
  onFocusMoment,
  placeholder,
  prose,
  readOnly = false,
  storyId,
  title,
}: MomentEditorProps) {
  // Lexical owns the text after mount; later store changes arrive through
  // ExternalProsePlugin.
  const [initial] = useState(() => ({
    markdown: prose?.markdown ?? "",
    revision: prose?.revision ?? 0,
  }));
  const autosave = useMomentAutosave({
    storyId,
    momentId,
    initialMarkdown: initial.markdown,
    initialRevision: initial.revision,
    createMoment,
  });
  const { boundMomentId, handleMarkdownChange } = autosave;
  const registryId = boundMomentId ?? STUDIO_UNBOUND_EDITOR_ID;
  const [isFocused, setIsFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!initial.markdown.trim());

  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "LocalInkStudioMoment",
      theme: STUDIO_EDITOR_THEME,
      editorState: () => {
        $convertFromMarkdownString(
          initial.markdown,
          STUDIO_MARKDOWN_TRANSFORMERS,
        );
      },
      onError(error) {
        momentEditorLogger.error("error", { errorName: error.name });
      },
    }),
    [initial.markdown],
  );

  const handleChange = useCallback(
    (editorState: EditorState, _editor: unknown, tags: Set<string>) => {
      const markdown = editorState.read(() =>
        $convertToMarkdownString(STUDIO_MARKDOWN_TRANSFORMERS),
      );
      setIsEmpty(!markdown.trim());
      if (tags.has(STUDIO_EXTERNAL_PROSE_TAG)) return;
      handleMarkdownChange(markdown);
    },
    [handleMarkdownChange],
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocusMoment(boundMomentId);
  }, [boundMomentId, onFocusMoment]);
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onBlurMoment(boundMomentId);
  }, [boundMomentId, onBlurMoment]);

  const showContinueLine = Boolean(continueLine) && isEmpty && !isFocused;
  const placeholderProps = placeholder
    ? {
        "aria-placeholder": placeholder,
        placeholder: (
          <span
            className={cn(
              STUDIO_PROSE_CLASS,
              "pointer-events-none absolute inset-x-0 top-0 select-none text-muted-foreground",
              !isSceneStart && "indent-[1.4em]",
            )}
          >
            {placeholder}
          </span>
        ),
      }
    : {};

  return (
    <>
      {showContinueLine ? continueLine : null}
      <div
        className={cn(
          "relative rounded-[2px] transition-colors",
          !isEmpty && HOVER_TINT_CLASS,
          isHighlighted && !isEmpty && STUDIO_MOMENT_TINT_CLASS,
        )}
        // Must match STUDIO_EDITOR_ATTRIBUTE; neighbours are found in DOM order.
        data-studio-editor={registryId}
      >
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                aria-label={`Moment: ${title.trim() || "untitled"}`}
                aria-multiline
                className={cn(
                  STUDIO_PROSE_CLASS,
                  "min-h-8 outline-none selection:bg-primary selection:text-primary-foreground",
                  isSceneStart && STUDIO_SCENE_START_CLASS,
                )}
                spellCheck
                {...placeholderProps}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <EditablePlugin editable={!readOnly} />
          <HistoryPlugin />
          <MarkdownShortcutPlugin transformers={STUDIO_MARKDOWN_TRANSFORMERS} />
          <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
          <MomentKeyboardPlugin registryId={registryId} />
          <MomentHandlePlugin
            flush={autosave.flush}
            registryId={registryId}
            retry={autosave.retry}
          />
          <FocusTrackingPlugin onBlur={handleBlur} onFocus={handleFocus} />
          {boundMomentId ? (
            <>
              <ExternalProsePlugin
                adoptExternal={autosave.adoptExternal}
                prose={prose}
              />
              <SelectionToolbarPlugin
                flush={autosave.flush}
                momentId={boundMomentId}
                storyId={storyId}
              />
            </>
          ) : null}
        </LexicalComposer>
      </div>
    </>
  );
});
