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
import { memo, useCallback, useMemo, useState } from "react";

import { createLogger } from "@/lib/logger";
import type { StudioProseDto } from "@/lib/studio/contracts";
import { cn } from "@/lib/util";

import {
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

type MomentEditorProps = {
  storyId: string;
  momentId: string;
  /** The beat's label, used only for the accessible label. */
  title: string;
  prose: StudioProseDto | undefined;
  isSceneStart: boolean;
  onFocusMoment: (momentId: string | null) => void;
  onBlurMoment: (momentId: string | null) => void;
};

/**
 * A minimal Lexical editor for one moment's prose. Moments stack with no
 * visible boundary: no tint, marker or hover state inside the text.
 */
export const MomentEditor = memo(function MomentEditor({
  isSceneStart,
  momentId,
  onBlurMoment,
  onFocusMoment,
  prose,
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
  });
  const { handleMarkdownChange } = autosave;
  const registryId = momentId;

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
      if (tags.has(STUDIO_EXTERNAL_PROSE_TAG)) return;
      handleMarkdownChange(markdown);
    },
    [handleMarkdownChange],
  );

  const handleFocus = useCallback(() => {
    onFocusMoment(momentId);
  }, [momentId, onFocusMoment]);
  const handleBlur = useCallback(() => {
    onBlurMoment(momentId);
  }, [momentId, onBlurMoment]);

  return (
    <div
      className="relative"
      // The reading-position observer finds editors by this attribute.
      data-moment-id={momentId}
      // Must match STUDIO_EDITOR_ATTRIBUTE; neighbours are found in DOM order.
      data-studio-editor={registryId}
    >
      <LexicalComposer initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              aria-label={`Moment: ${title}`}
              aria-multiline
              className={cn(
                STUDIO_PROSE_CLASS,
                "min-h-8 outline-none selection:bg-primary selection:text-primary-foreground",
                isSceneStart && STUDIO_SCENE_START_CLASS,
              )}
              spellCheck
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
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
        <ExternalProsePlugin
          adoptExternal={autosave.adoptExternal}
          prose={prose}
        />
        <SelectionToolbarPlugin momentId={momentId} storyId={storyId} />
      </LexicalComposer>
    </div>
  );
});
