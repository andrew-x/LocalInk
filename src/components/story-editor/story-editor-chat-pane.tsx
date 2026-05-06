"use client";

import {
  Copy,
  History,
  MessageSquare,
  Plus,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
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
  PopoverContent,
  PopoverTrigger,
} from "@/components/common/popover";
import { Textarea } from "@/components/common/textarea";
import { StoryEditorPaneHeader } from "@/components/story-editor/story-editor-pane-header";
import day from "@/lib/dayjs";
import type { StoryChatStreamRequest } from "@/lib/story-chat-contract";
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
  isStreaming?: boolean;
};

type ActionFailureResult = {
  serverError?: {
    message?: string;
  };
  validationErrors?: {
    formErrors?: string[];
  };
};

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
  const prepareTurnAction = useAction(prepareStoryChatTurn);
  const prepareRegenerationAction = useAction(prepareStoryChatRegeneration);
  const saveAssistantOutputAction = useAction(saveStoryChatAssistantOutput);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatId = activeChat?.id ?? null;
  const latestAssistantMessageId = getLatestAssistantMessageId(messages);
  const isBusy =
    isStreaming ||
    isLoadingChat ||
    prepareTurnAction.isPending ||
    prepareRegenerationAction.isPending ||
    saveAssistantOutputAction.isPending;

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
    void refreshChats();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refreshChats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  });

  function handleStartNewChat() {
    if (isBusy) {
      return;
    }

    setActiveChat(null);
    setMessages([]);
    setDraftContent("");
    setIsHistoryOpen(false);
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
    setMessages((currentMessages) => {
      if (replaceAssistantMessageId) {
        return currentMessages.map((message) =>
          message.id === replaceAssistantMessageId
            ? { ...message, content: "", isStreaming: true, updatedAt: now }
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
          isStreaming: true,
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

      if (!response.body) {
        throw new Error("The chat stream could not be opened.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        streamedText += decoder.decode(value, { stream: true });
        updateStreamingMessage(draftMessageId, streamedText);
      }

      const finalChunk = decoder.decode();

      if (finalChunk) {
        streamedText += finalChunk;
        updateStreamingMessage(draftMessageId, streamedText);
      }

      const savedOutput = await saveAssistantOutput(generation, streamedText);

      if (!savedOutput) {
        restoreFailedStream(draftMessageId, previousMessage);
        return;
      }

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

    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? { ...message, content, isStreaming: true, updatedAt }
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

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void handleSendMessage();
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
                  className="w-72 max-w-[calc(100vw-2rem)] p-2"
                >
                  <div className="max-h-80 overflow-auto">
                    {isLoadingChats ? (
                      <p className="px-2 py-3 text-body text-muted-foreground">
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
                            <span className="block truncate text-label-sm">
                              {chat.title}
                            </span>
                            <span className="block text-caption text-muted-foreground">
                              {formatTimestamp(chat.updatedAt)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-2 py-3 text-body text-muted-foreground">
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

          <div className="min-h-0 flex-1 overflow-auto px-3 py-4">
            {messages.length ? (
              <ol className="grid gap-4">
                {messages.map((message) => (
                  <ChatMessage
                    canRegenerate={
                      message.role === "assistant" &&
                      message.id === latestAssistantMessageId &&
                      !message.isStreaming
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
              <Textarea
                aria-label="Story chat message"
                className="max-h-36 min-h-20 resize-none"
                disabled={isBusy}
                maxLength={4000}
                onChange={(event) => setDraftContent(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                placeholder="Ask about the story"
                value={draftContent}
              />
              <div className="flex justify-end">
                <Button
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

  if (isAssistant) {
    return (
      <li className="grid gap-1.5">
        <div className="whitespace-pre-wrap break-words font-content text-[0.875rem] leading-6 text-foreground">
          {message.content || (message.isStreaming ? " " : "")}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <MessageActionButton
            disabled={!message.content}
            icon={<Copy aria-hidden="true" className="size-3" />}
            label="Copy assistant message"
            onClick={() => void onCopy(message)}
            tooltip="Copy"
          />
          {canRegenerate ? (
            <MessageActionButton
              disabled={isBusy}
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
