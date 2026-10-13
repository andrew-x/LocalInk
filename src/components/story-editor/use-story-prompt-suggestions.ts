"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  type StoryPromptContext,
  type StoryPromptSuggestionsRequest,
  storyPromptExpansionResponseSchema,
  storyPromptIdeasResponseSchema,
} from "@/lib/story-prompt-suggestions-contract";

type Options = {
  disabled: boolean;
  scopeKey: string;
  readContext: () => StoryPromptContext | null;
  subscribeToContextChanges: (listener: () => void) => () => void;
  onApply: (prompt: string) => void;
  onError: (message: string | null) => void;
};

type IdeaSet = {
  context: StoryPromptContext;
  key: string;
  ideas: string[];
};

const STALE_MESSAGE =
  "The story or prompt changed. Refresh ideas to use the latest version.";

class SuggestionError extends Error {}

export function useStoryPromptSuggestions(options: Options) {
  const latest = useRef(options);
  const controllerRef = useRef<AbortController | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const previousScopeRef = useRef(options.scopeKey);
  const [isOpen, setIsOpen] = useState(false);
  const [ideaSet, setIdeaSet] = useState<IdeaSet | null>(null);
  const [pending, setPending] = useState<"ideas" | "expand" | null>(null);
  const [selectedIdea, setSelectedIdea] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  // Async completions must compare against the latest editor and form values,
  // not the render that launched the request.
  useLayoutEffect(() => {
    latest.current = options;
  });

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    requestKeyRef.current = null;
    setPending(null);
    setSelectedIdea(null);
  }, []);

  const close = useCallback(() => {
    cancel();
    setIsOpen(false);
  }, [cancel]);

  const reset = useCallback(() => {
    close();
    setIdeaSet(null);
    setIsStale(false);
  }, [close]);

  // A chapter switch or an active draft invalidates both in-flight work and
  // cached ideas. Editor content changes are also checked at every use.
  const { disabled, scopeKey } = options;
  useEffect(() => {
    if (disabled || previousScopeRef.current !== scopeKey) reset();
    previousScopeRef.current = scopeKey;
  }, [disabled, scopeKey, reset]);

  const { readContext, subscribeToContextChanges } = options;
  useEffect(() => {
    if (!isOpen || (isStale && !pending)) return;
    let frame: number | null = null;
    const checkContext = () => {
      frame = null;
      const key = controllerRef.current ? requestKeyRef.current : ideaSet?.key;
      if (!key) return;
      try {
        const current = readContext();
        if (!current || getContextKey(current) !== key) {
          cancel();
          setIsStale(true);
        }
      } catch {
        cancel();
        setIsStale(true);
        latest.current.onError(
          "The story context could not be read. Please try again.",
        );
      }
    };
    const scheduleCheck = () => {
      if (frame === null) frame = requestAnimationFrame(checkContext);
    };
    // Defer reads until Lexical has committed the notifying update. Coalesce
    // events from multiple chapters, and never start a generation here.
    const unsubscribe = subscribeToContextChanges(scheduleCheck);
    scheduleCheck();
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [
    isOpen,
    isStale,
    pending,
    ideaSet,
    readContext,
    subscribeToContextChanges,
    cancel,
  ]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  function contextStillMatches(key: string) {
    const current = latest.current.readContext();
    return current !== null && getContextKey(current) === key;
  }

  function reportError(error: unknown) {
    latest.current.onError(
      error instanceof SuggestionError
        ? error.message
        : "Suggestions could not be generated. Please try again.",
    );
  }

  async function run(input: StoryPromptSuggestionsRequest, key: string) {
    cancel();
    const controller = new AbortController();
    const requestScope = latest.current.scopeKey;
    controllerRef.current = controller;
    requestKeyRef.current = key;
    setPending(input.operation);
    setSelectedIdea(input.operation === "expand" ? input.selectedIdea : null);
    latest.current.onError(null);

    try {
      const response = await fetch("/api/story-prompt-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (
        controllerRef.current !== controller ||
        controller.signal.aborted ||
        latest.current.disabled ||
        latest.current.scopeKey !== requestScope
      )
        return;
      if (!response.ok) throw new SuggestionError(getResponseError(body));
      if (!contextStillMatches(key)) {
        setIsStale(true);
        throw new SuggestionError(STALE_MESSAGE);
      }

      if (input.operation === "ideas") {
        const result = storyPromptIdeasResponseSchema.safeParse(body);
        if (!result.success)
          throw new SuggestionError(
            "The ideas were incomplete. Please try again.",
          );
        setIdeaSet({ context: input.context, key, ideas: result.data.ideas });
        setIsStale(false);
      } else {
        const result = storyPromptExpansionResponseSchema.safeParse(body);
        if (!result.success)
          throw new SuggestionError(
            "The prompt was incomplete. Please try again.",
          );
        latest.current.onApply(result.data.prompt);
        setIsOpen(false);
        setIdeaSet(null);
        setIsStale(false);
      }
    } catch (error) {
      if (
        controllerRef.current === controller &&
        !controller.signal.aborted &&
        !latest.current.disabled &&
        latest.current.scopeKey === requestScope
      ) {
        reportError(error);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        requestKeyRef.current = null;
        setPending(null);
        setSelectedIdea(null);
      }
    }
  }

  async function showIdeas(refresh = false) {
    if (latest.current.disabled) return;
    cancel();
    // Let the panel receive focus before reading the insertion target. Some
    // browsers do not focus clicked buttons, leaving a manuscript caret alive
    // until the panel itself takes focus.
    const opening = new AbortController();
    const openingScope = latest.current.scopeKey;
    controllerRef.current = opening;
    setIsOpen(true);
    setPending("ideas");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (
      controllerRef.current !== opening ||
      opening.signal.aborted ||
      latest.current.disabled ||
      latest.current.scopeKey !== openingScope
    )
      return;
    try {
      const context = latest.current.readContext();
      if (!context)
        throw new SuggestionError(
          "Select an available chapter and finish any draft before requesting ideas.",
        );
      const key = getContextKey(context);
      if (!refresh && ideaSet) {
        setIsStale(ideaSet.key !== key);
        latest.current.onError(null);
        return;
      }
      if (ideaSet && ideaSet.key !== key) setIsStale(true);
      await run(
        { operation: "ideas", context, previousIdeas: ideaSet?.ideas },
        key,
      );
    } catch (error) {
      if (controllerRef.current === opening && !opening.signal.aborted)
        reportError(error);
    } finally {
      if (controllerRef.current === opening) cancel();
    }
  }

  async function expand(idea: string) {
    if (!ideaSet || pending || latest.current.disabled) return;
    try {
      if (!contextStillMatches(ideaSet.key)) {
        setIsStale(true);
        throw new SuggestionError(STALE_MESSAGE);
      }
      await run(
        { operation: "expand", context: ideaSet.context, selectedIdea: idea },
        ideaSet.key,
      );
    } catch (error) {
      reportError(error);
    }
  }

  return {
    isOpen,
    ideas: ideaSet?.ideas ?? [],
    pending,
    selectedIdea,
    isStale,
    showIdeas,
    expand,
    close,
    reset,
  };
}

function getContextKey(context: StoryPromptContext) {
  // Synopsis refreshes and autosave revisions do not change what the writer
  // wrote. Compare actual Markdown, insertion anchors and writing guidance.
  return JSON.stringify({
    ...context,
    chapters: context.chapters.map(({ synopsis: _, ...chapter }) => chapter),
    focusedChapter: { ...context.focusedChapter, synopsis: "" },
  });
}

function getResponseError(body: unknown): string {
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? body.code
      : null;
  switch (code) {
    case "AI_NOT_CONFIGURED":
      return "Configure the AI connection before requesting ideas.";
    case "AI_ZDR_UNAVAILABLE":
      return "No zero-data-retention provider is available for this model.";
    case "MANUSCRIPT_CONTEXT_TOO_LARGE":
      return "The story context is too large for this model. Shorten the focused passage or reference instructions and try again.";
    case "MAINTENANCE":
      return "Suggestions are temporarily unavailable. Please try again later.";
    case "BAD_REQUEST":
      return "The suggestion request is invalid. Check the prompt and try again.";
    default:
      return "Suggestions could not be generated. Please try again.";
  }
}
