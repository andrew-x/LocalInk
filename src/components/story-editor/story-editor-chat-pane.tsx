"use client";

import {
  Copy,
  History,
  MapPin,
  MessageSquare,
  PenLine,
  Plus,
  RefreshCcw,
  Send,
  UserRound,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type {
  PreparedStoryChatGeneration,
  SavedStoryChatAssistantOutput,
  StoryChatDetail,
  StoryChatListItem,
  StoryChatVisibleMessage,
} from "@/actions/story-chats/_types";
import { getStoryChat } from "@/actions/story-chats/get-story-chat";
import { getStoryChats } from "@/actions/story-chats/get-story-chats";
import { prepareStoryChatRegeneration } from "@/actions/story-chats/prepare-story-chat-regeneration";
import { prepareStoryChatTurn } from "@/actions/story-chats/prepare-story-chat-turn";
import { saveStoryChatAssistantOutput } from "@/actions/story-chats/save-story-chat-assistant-output";
import { Button } from "@/components/common/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { Textarea } from "@/components/common/textarea";
import { StoryEditorPaneHeader } from "@/components/story-editor/story-editor-pane-header";
import { readLocalinkTextStream } from "@/lib/ai-text-stream";
import day from "@/lib/dayjs";
import type { StoryChatStreamRequest } from "@/lib/story-chat-contract";
import {
  filterStoryChatSlashCommands,
  getStoryChatSlashCommandDraft,
  type StoryChatSlashCommandMetadata,
  type StoryChatSlashCommandName,
} from "@/lib/story-chat-slash-commands";
import { cn } from "@/lib/util";

type StoryEditorChatPaneProps = {
  isOpen: boolean;
  onToggleOpen: () => void;
  story: {
    id: string;
    name: string;
  };
};

type DraftStoryChatMessage = StoryChatVisibleMessage & {
  streamStatus?: "waiting" | "streaming";
};

type ActionFailureResult = {
  serverError?: {
    message?: string;
  };
  validationErrors?: {
    formErrors?: string[];
  };
};

type LatestMessageScrollMode = "force" | "follow";

type LatestMessageScrollRequest = {
  count: number;
  mode: LatestMessageScrollMode;
};

const LATEST_MESSAGE_SCROLL_THRESHOLD_PX = 48;

export function StoryEditorChatPane({
  isOpen,
  onToggleOpen,
  story,
}: StoryEditorChatPaneProps) {
  const [chats, setChats] = useState<StoryChatListItem[]>([]);
  const [activeChat, setActiveChat] = useState<StoryChatListItem | null>(null);
  const [messages, setMessages] = useState<DraftStoryChatMessage[]>([]);
  const [draftContent, setDraftContent] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [scrollRequest, setScrollRequest] =
    useState<LatestMessageScrollRequest>({ count: 0, mode: "force" });
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0);
  const [dismissedSlashCommandPrefix, setDismissedSlashCommandPrefix] =
    useState<string | null>(null);
  const prepareTurnAction = useAction(prepareStoryChatTurn);
  const prepareRegenerationAction = useAction(prepareStoryChatRegeneration);
  const saveAssistantOutputAction = useAction(saveStoryChatAssistantOutput);
  const slashCommandListId = useId();
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesScrollPaneRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowLatestMessageRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatId = activeChat?.id ?? null;
  const latestAssistantMessageId = getLatestAssistantMessageId(messages);
  const isBusy =
    isStreaming ||
    isLoadingChat ||
    prepareTurnAction.isPending ||
    prepareRegenerationAction.isPending ||
    saveAssistantOutputAction.isPending;
  const slashCommandDraft = getStoryChatSlashCommandDraft(draftContent);
  const slashCommandPrefix = slashCommandDraft
    ? `/${slashCommandDraft.query}`
    : null;
  const slashCommandMatches = slashCommandDraft
    ? filterStoryChatSlashCommands(slashCommandDraft.query)
    : [];
  const activeSlashCommand =
    slashCommandMatches[activeSlashCommandIndex] ?? slashCommandMatches[0];
  const isSlashCommandMenuOpen = Boolean(
    slashCommandDraft &&
      !slashCommandDraft.hasArguments &&
      !isBusy &&
      dismissedSlashCommandPrefix !== slashCommandPrefix,
  );

  const isScrolledToLatestMessage = useCallback(() => {
    const scrollPane = messagesScrollPaneRef.current;

    if (!scrollPane) {
      return true;
    }

    return (
      scrollPane.scrollHeight -
        scrollPane.scrollTop -
        scrollPane.clientHeight <=
      LATEST_MESSAGE_SCROLL_THRESHOLD_PX
    );
  }, []);

  const scrollToLatestMessage = useCallback(
    (mode: LatestMessageScrollMode = "force") => {
      window.requestAnimationFrame(() => {
        if (mode === "follow" && !shouldFollowLatestMessageRef.current) {
          return;
        }

        const scrollPane = messagesScrollPaneRef.current;

        if (scrollPane) {
          scrollPane.scrollTop = scrollPane.scrollHeight;
        } else {
          messagesEndRef.current?.scrollIntoView({ block: "end" });
        }

        shouldFollowLatestMessageRef.current = true;
      });
    },
    [],
  );

  const requestScrollToLatestMessage = useCallback(
    (mode: LatestMessageScrollMode = "force") => {
      if (mode === "follow" && !shouldFollowLatestMessageRef.current) {
        return;
      }

      setScrollRequest((currentRequest) => ({
        count: currentRequest.count + 1,
        mode,
      }));
    },
    [],
  );

  const handleMessagesScroll = useCallback(() => {
    shouldFollowLatestMessageRef.current = isScrolledToLatestMessage();
  }, [isScrolledToLatestMessage]);

  const requestFollowedScrollToLatestMessage = useCallback(() => {
    requestScrollToLatestMessage("follow");
  }, [requestScrollToLatestMessage]);

  const requestForcedScrollToLatestMessage = useCallback(() => {
    requestScrollToLatestMessage();
  }, [requestScrollToLatestMessage]);

  const refreshChats = useCallback(async () => {
    setIsLoadingChats(true);

    try {
      setChats(await getStoryChats({ storyId: story.id }));
    } catch {
      toast.error("The chat history could not be loaded.");
    } finally {
      setIsLoadingChats(false);
    }
  }, [story.id]);

  useEffect(() => {
    setActiveChat(null);
    setMessages([]);
    setDraftContent("");
    requestForcedScrollToLatestMessage();
    void refreshChats();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refreshChats, requestForcedScrollToLatestMessage]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    scrollToLatestMessage();
  }, [isOpen, scrollToLatestMessage]);

  useEffect(() => {
    if (!isOpen || scrollRequest.count === 0) {
      return;
    }

    if (
      scrollRequest.mode === "follow" &&
      !shouldFollowLatestMessageRef.current
    ) {
      return;
    }

    scrollToLatestMessage(scrollRequest.mode);
  }, [isOpen, scrollRequest.count, scrollRequest.mode, scrollToLatestMessage]);

  useEffect(() => {
    if (activeSlashCommandIndex >= slashCommandMatches.length) {
      setActiveSlashCommandIndex(0);
    }
  }, [activeSlashCommandIndex, slashCommandMatches.length]);

  useEffect(() => {
    if (!slashCommandDraft) {
      setDismissedSlashCommandPrefix(null);
    }
  }, [slashCommandDraft]);

  function handleStartNewChat() {
    if (isBusy) {
      return;
    }

    setActiveChat(null);
    setMessages([]);
    setDraftContent("");
    setIsHistoryOpen(false);
    requestForcedScrollToLatestMessage();
  }

  async function handleLoadChat(chatId: string) {
    if (isBusy) {
      return;
    }

    setIsLoadingChat(true);

    try {
      const chat = await getStoryChat({ storyId: story.id, chatId });

      if (!chat) {
        toast.error("The chat could not be loaded.");
        return;
      }

      setActiveChat(toChatListItem(chat));
      setMessages(chat.messages);
      setDraftContent("");
      setIsHistoryOpen(false);
      requestForcedScrollToLatestMessage();
    } catch {
      toast.error("The chat could not be loaded.");
    } finally {
      setIsLoadingChat(false);
    }
  }

  async function handleSendMessage() {
    const content = draftContent.trim();

    if (!content || isBusy) {
      return;
    }

    const result = await prepareTurnAction.executeAsync({
      storyId: story.id,
      chatId: activeChatId,
      content,
    });

    if (!result.data) {
      toast.error(
        getActionFailureMessage(result, "The chat message could not be sent."),
      );
      return;
    }

    setDraftContent("");
    applyPreparedGeneration(result.data);
    await streamAssistantReply(result.data);
  }

  async function handleRegenerate(message: StoryChatVisibleMessage) {
    if (isBusy || message.id !== latestAssistantMessageId || !activeChatId) {
      return;
    }

    const result = await prepareRegenerationAction.executeAsync({
      storyId: story.id,
      chatId: activeChatId,
      assistantMessageId: message.id,
    });

    if (!result.data) {
      toast.error(
        getActionFailureMessage(
          result,
          "The assistant reply could not be regenerated.",
        ),
      );
      return;
    }

    applyPreparedGeneration(result.data);
    await streamAssistantReply(result.data);
  }

  function applyPreparedGeneration(generation: PreparedStoryChatGeneration) {
    setActiveChat(generation.chat);
    setMessages(generation.messages);
    upsertChat(generation.chat);
    requestFollowedScrollToLatestMessage();
  }

  async function streamAssistantReply(generation: PreparedStoryChatGeneration) {
    const replaceAssistantMessageId = generation.replaceAssistantMessageId;
    const draftMessageId =
      replaceAssistantMessageId ?? `draft-${generation.generationId}`;
    const previousMessage = replaceAssistantMessageId
      ? messages.find((message) => message.id === replaceAssistantMessageId)
      : undefined;
    const now = day().toISOString();
    const controller = new AbortController();
    let streamedText = "";

    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setIsStreaming(true);
    requestFollowedScrollToLatestMessage();
    setMessages((currentMessages) => {
      if (replaceAssistantMessageId) {
        return currentMessages.map((message) =>
          message.id === replaceAssistantMessageId
            ? {
                ...message,
                content: "",
                streamStatus: "waiting",
                updatedAt: now,
              }
            : message,
        );
      }

      return [
        ...currentMessages,
        {
          id: draftMessageId,
          role: "assistant",
          content: "",
          createdAt: now,
          updatedAt: now,
          streamStatus: "waiting",
        },
      ];
    });

    try {
      const response = await fetch("/api/story-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storyId: story.id,
          chatId: generation.chat.id,
          generationId: generation.generationId,
          contextMessageId: generation.contextMessageId,
          replaceAssistantMessageId,
        } satisfies StoryChatStreamRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(await readStoryChatStreamError(response));
      }

      await readLocalinkTextStream(response, {
        incompleteMessage: "The chat stream ended before the reply completed.",
        unavailableMessage: "The chat stream could not be opened.",
        onDelta(text) {
          streamedText += text;
          updateStreamingMessage(draftMessageId, streamedText);
        },
      });

      const savedOutput = await saveAssistantOutput(generation, streamedText);

      if (!savedOutput) {
        restoreFailedStream(draftMessageId, previousMessage);
        return;
      }

      requestFollowedScrollToLatestMessage();
      setMessages((currentMessages) =>
        replaceAssistantMessageId
          ? currentMessages.map((message) =>
              message.id === replaceAssistantMessageId
                ? savedOutput.message
                : message,
            )
          : currentMessages.map((message) =>
              message.id === draftMessageId ? savedOutput.message : message,
            ),
      );
      setActiveChat(savedOutput.chat);
      upsertChat(savedOutput.chat);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(getStoryChatFailureMessage(error));
      }

      restoreFailedStream(draftMessageId, previousMessage);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }

      setIsStreaming(false);
    }
  }

  async function saveAssistantOutput(
    generation: PreparedStoryChatGeneration,
    content: string,
  ): Promise<SavedStoryChatAssistantOutput | null> {
    const result = await saveAssistantOutputAction.executeAsync({
      storyId: story.id,
      chatId: generation.chat.id,
      generationId: generation.generationId,
      contextMessageId: generation.contextMessageId,
      replaceAssistantMessageId: generation.replaceAssistantMessageId,
      content,
    });

    if (!result.data) {
      toast.error(
        getActionFailureMessage(
          result,
          "The assistant reply could not be saved.",
        ),
      );
      return null;
    }

    return result.data;
  }

  function updateStreamingMessage(messageId: string, content: string) {
    const updatedAt = day().toISOString();
    const streamStatus = content.length > 0 ? "streaming" : "waiting";

    requestFollowedScrollToLatestMessage();
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? { ...message, content, streamStatus, updatedAt }
          : message,
      ),
    );
  }

  function restoreFailedStream(
    messageId: string,
    previousMessage: StoryChatVisibleMessage | undefined,
  ) {
    setMessages((currentMessages) => {
      if (previousMessage) {
        return currentMessages.map((message) =>
          message.id === previousMessage.id ? previousMessage : message,
        );
      }

      return currentMessages.filter((message) => message.id !== messageId);
    });
  }

  function upsertChat(chat: StoryChatListItem) {
    setChats((currentChats) =>
      [chat, ...currentChats.filter((item) => item.id !== chat.id)].sort(
        (firstChat, secondChat) =>
          day(secondChat.updatedAt).valueOf() -
          day(firstChat.updatedAt).valueOf(),
      ),
    );
  }

  async function handleCopyMessage(message: StoryChatVisibleMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success("Copied.");
    } catch {
      toast.error("The message could not be copied.");
    }
  }

  function handleDraftContentChange(content: string) {
    const nextSlashCommandDraft = getStoryChatSlashCommandDraft(content);

    if (slashCommandDraft?.query !== nextSlashCommandDraft?.query) {
      setActiveSlashCommandIndex(0);
    }

    setDraftContent(content);
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSlashCommandMenuOpen) {
      if (event.key === "ArrowDown" && slashCommandMatches.length > 0) {
        event.preventDefault();
        setActiveSlashCommandIndex(
          (currentIndex) => (currentIndex + 1) % slashCommandMatches.length,
        );
        return;
      }

      if (event.key === "ArrowUp" && slashCommandMatches.length > 0) {
        event.preventDefault();
        setActiveSlashCommandIndex(
          (currentIndex) =>
            (currentIndex - 1 + slashCommandMatches.length) %
            slashCommandMatches.length,
        );
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        if (slashCommandPrefix) {
          setDismissedSlashCommandPrefix(slashCommandPrefix);
        }

        return;
      }

      if (
        ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") &&
        activeSlashCommand
      ) {
        event.preventDefault();
        selectSlashCommand(activeSlashCommand);
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void handleSendMessage();
  }

  function selectSlashCommand(command: StoryChatSlashCommandMetadata) {
    setDraftContent(`${command.token} `);
    setDismissedSlashCommandPrefix(command.token);
    window.requestAnimationFrame(() => {
      draftTextareaRef.current?.focus();
    });
  }

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border/80 border-t bg-sidebar/70 lg:border-t-0 lg:border-l">
      <StoryEditorPaneHeader
        isOpen={isOpen}
        label="Chat"
        onToggle={onToggleOpen}
        side="right"
      />

      {isOpen ? (
        <>
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-border/80 border-b px-3">
            <div className="min-w-0">
              <h2 className="truncate text-label">
                {activeChat?.title ?? story.name}
              </h2>
              <p className="text-caption text-muted-foreground">
                {activeChat
                  ? formatTimestamp(activeChat.updatedAt)
                  : "New chat"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Popover open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                <PopoverTrigger asChild>
                  <Button
                    aria-label="Open chat history"
                    disabled={isBusy}
                    onClick={() => {
                      if (!isHistoryOpen && !chats.length) {
                        void refreshChats();
                      }
                    }}
                    size="icon"
                    tooltip="Chat history"
                    type="button"
                    variant="ghost"
                  >
                    <History aria-hidden="true" className="size-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-96 max-w-[calc(100vw-2rem)] p-2"
                >
                  <div className="max-h-80 overflow-auto">
                    {isLoadingChats ? (
                      <p className="px-2 py-3 text-caption text-muted-foreground">
                        Loading chats
                      </p>
                    ) : chats.length ? (
                      <div className="grid gap-1">
                        {chats.map((chat) => (
                          <button
                            className={cn(
                              "rounded-md px-2 py-2 text-left transition-[background-color,color] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                              activeChat?.id === chat.id && "bg-muted",
                            )}
                            key={chat.id}
                            onClick={() => void handleLoadChat(chat.id)}
                            type="button"
                          >
                            <span className="block truncate text-caption font-medium">
                              {chat.title}
                            </span>
                            <span className="block text-caption text-muted-foreground">
                              {formatTimestamp(chat.updatedAt)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 py-3 text-caption text-muted-foreground">
                        No saved chats
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                aria-label="Start new chat"
                disabled={isBusy && !isLoadingChats}
                onClick={handleStartNewChat}
                size="icon"
                tooltip="New chat"
                type="button"
                variant="ghost"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto px-3 py-4"
            onScroll={handleMessagesScroll}
            ref={messagesScrollPaneRef}
          >
            {messages.length ? (
              <ol className="grid gap-4">
                {messages.map((message) => (
                  <ChatMessage
                    canRegenerate={
                      message.role === "assistant" &&
                      message.id === latestAssistantMessageId &&
                      !message.streamStatus &&
                      Boolean(message.content.trim())
                    }
                    isBusy={isBusy}
                    key={message.id}
                    message={message}
                    onCopy={handleCopyMessage}
                    onRegenerate={handleRegenerate}
                  />
                ))}
              </ol>
            ) : (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/70 px-4 text-center text-muted-foreground">
                <MessageSquare aria-hidden="true" className="size-5" />
                <p className="text-body">No messages yet</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="shrink-0 border-border/80 border-t p-3">
            <div className="grid gap-2">
              <Popover
                open={isSlashCommandMenuOpen}
                onOpenChange={(open) => {
                  if (!open && slashCommandPrefix) {
                    setDismissedSlashCommandPrefix(slashCommandPrefix);
                  }
                }}
              >
                <PopoverAnchor asChild>
                  <Textarea
                    aria-activedescendant={
                      isSlashCommandMenuOpen && activeSlashCommand
                        ? getSlashCommandOptionId(
                            slashCommandListId,
                            activeSlashCommand.name,
                          )
                        : undefined
                    }
                    aria-autocomplete="list"
                    aria-controls={
                      isSlashCommandMenuOpen ? slashCommandListId : undefined
                    }
                    aria-expanded={isSlashCommandMenuOpen}
                    aria-haspopup="listbox"
                    aria-label="Story chat message"
                    className="max-h-48 min-h-24 resize-none px-2.5 py-1.5 text-label-sm"
                    disabled={isBusy}
                    maxLength={4000}
                    onChange={(event) =>
                      handleDraftContentChange(event.target.value)
                    }
                    onKeyDown={handleDraftKeyDown}
                    placeholder="Ask about the story"
                    ref={draftTextareaRef}
                    value={draftContent}
                  />
                </PopoverAnchor>
                <PopoverContent
                  align="start"
                  className="w-80 max-w-[calc(100vw-2rem)] p-1.5"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  side="top"
                  sideOffset={6}
                >
                  <SlashCommandMenu
                    activeCommandName={activeSlashCommand?.name ?? null}
                    commands={slashCommandMatches}
                    listId={slashCommandListId}
                    onActiveCommandChange={(commandName) => {
                      const commandIndex = slashCommandMatches.findIndex(
                        (command) => command.name === commandName,
                      );

                      if (commandIndex >= 0) {
                        setActiveSlashCommandIndex(commandIndex);
                      }
                    }}
                    onSelect={selectSlashCommand}
                  />
                </PopoverContent>
              </Popover>
              <div className="flex justify-end">
                <Button
                  className="h-7 gap-1 px-2 text-label-sm [&_svg]:size-3.5"
                  disabled={!draftContent.trim() || isBusy}
                  leftSection={<Send aria-hidden="true" />}
                  loading={prepareTurnAction.isPending || isStreaming}
                  onClick={() => void handleSendMessage()}
                  size="sm"
                  type="button"
                >
                  Send
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
}

type SlashCommandMenuProps = {
  activeCommandName: StoryChatSlashCommandName | null;
  commands: StoryChatSlashCommandMetadata[];
  listId: string;
  onActiveCommandChange: (commandName: StoryChatSlashCommandName) => void;
  onSelect: (command: StoryChatSlashCommandMetadata) => void;
};

function SlashCommandMenu({
  activeCommandName,
  commands,
  listId,
  onActiveCommandChange,
  onSelect,
}: SlashCommandMenuProps) {
  if (!commands.length) {
    return (
      <p className="px-2 py-2 text-body text-muted-foreground">
        No matching commands
      </p>
    );
  }

  return (
    <div className="grid gap-1" id={listId} role="listbox">
      {commands.map((command) => {
        const isActive = command.name === activeCommandName;

        return (
          <button
            aria-selected={isActive}
            className={cn(
              "grid w-full grid-cols-[1.75rem_1fr] items-start gap-2 rounded-md px-2 py-2 text-left transition-[background-color,color] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
              isActive && "bg-muted",
            )}
            id={getSlashCommandOptionId(listId, command.name)}
            key={command.name}
            onClick={() => onSelect(command)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onActiveCommandChange(command.name)}
            role="option"
            type="button"
          >
            <span className="mt-0.5 flex size-6 items-center justify-center rounded-md border border-border/70 bg-card text-muted-foreground">
              <SlashCommandIcon commandName={command.name} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-label-sm">
                {command.token}
              </span>
              <span className="block text-caption text-muted-foreground">
                {command.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SlashCommandIcon({
  commandName,
}: {
  commandName: StoryChatSlashCommandName;
}) {
  switch (commandName) {
    case "style":
      return <PenLine aria-hidden="true" className="size-3.5" />;
    case "character":
      return <UserRound aria-hidden="true" className="size-3.5" />;
    case "location":
      return <MapPin aria-hidden="true" className="size-3.5" />;
  }
}

function getSlashCommandOptionId(
  listId: string,
  commandName: StoryChatSlashCommandName,
) {
  return `${listId}-${commandName}`;
}

type ChatMessageProps = {
  canRegenerate: boolean;
  isBusy: boolean;
  message: DraftStoryChatMessage;
  onCopy: (message: StoryChatVisibleMessage) => Promise<void>;
  onRegenerate: (message: StoryChatVisibleMessage) => Promise<void>;
};

function ChatMessage({
  canRegenerate,
  isBusy,
  message,
  onCopy,
  onRegenerate,
}: ChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const hasContent = message.content.trim().length > 0;
  const isWaitingForAssistant =
    message.streamStatus === "waiting" ||
    (message.streamStatus === "streaming" && message.content.length === 0);

  if (isAssistant) {
    return (
      <li className="grid gap-1.5">
        {isWaitingForAssistant ? (
          <AssistantWaitingMessage />
        ) : (
          <div className="whitespace-pre-wrap break-words font-content text-[0.875rem] leading-6 text-foreground">
            {message.content}
          </div>
        )}
        <div className="flex items-center gap-1 text-muted-foreground">
          <MessageActionButton
            disabled={!hasContent}
            icon={<Copy aria-hidden="true" className="size-3" />}
            label="Copy assistant message"
            onClick={() => void onCopy(message)}
            tooltip="Copy"
          />
          {canRegenerate ? (
            <MessageActionButton
              disabled={isBusy || !hasContent}
              icon={<RefreshCcw aria-hidden="true" className="size-3" />}
              label="Regenerate assistant message"
              onClick={() => void onRegenerate(message)}
              tooltip="Regenerate"
            />
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <li className="grid justify-items-end gap-1.5">
      <div className="max-w-[88%] rounded-md border border-primary/20 bg-primary px-3 py-2 text-primary-foreground shadow-xs">
        <p className="whitespace-pre-wrap break-words text-[0.8125rem] leading-5">
          {message.content}
        </p>
      </div>
      <div className="flex items-center gap-1 text-muted-foreground">
        <MessageActionButton
          disabled={!message.content}
          icon={<Copy aria-hidden="true" className="size-3" />}
          label="Copy user message"
          onClick={() => void onCopy(message)}
          tooltip="Copy"
        />
      </div>
    </li>
  );
}

function AssistantWaitingMessage() {
  return (
    <output
      aria-label="Waiting for assistant reply"
      className="flex h-6 items-center gap-1.5 text-muted-foreground"
    >
      <span aria-hidden="true" className="inline-flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-primary/70" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary/50 [animation-delay:150ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary/35 [animation-delay:300ms]" />
      </span>
    </output>
  );
}

type MessageActionButtonProps = {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tooltip: string;
};

function MessageActionButton({
  disabled,
  icon,
  label,
  onClick,
  tooltip,
}: MessageActionButtonProps) {
  return (
    <Button
      aria-label={label}
      className="size-6 text-muted-foreground hover:text-foreground"
      disabled={disabled}
      onClick={onClick}
      size="icon"
      tooltip={tooltip}
      type="button"
      variant="ghost"
    >
      {icon}
    </Button>
  );
}

function getLatestAssistantMessageId(messages: StoryChatVisibleMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      return messages[index]?.id ?? null;
    }
  }

  return null;
}

function toChatListItem(chat: StoryChatDetail): StoryChatListItem {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

async function readStoryChatStreamError(response: Response) {
  try {
    const data = (await response.json()) as { message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    return "The chat reply could not be generated.";
  }

  return "The chat reply could not be generated.";
}

function getStoryChatFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "The chat reply could not be generated.";
}

function getActionFailureMessage(
  result: ActionFailureResult,
  fallbackMessage: string,
) {
  return (
    result.validationErrors?.formErrors?.[0] ??
    result.serverError?.message ??
    fallbackMessage
  );
}

function formatTimestamp(value: string) {
  const date = day(value);

  if (!date.isValid()) {
    return "recently";
  }

  return date.format("lll");
}
