"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useEventCallback } from "@/hooks/use-event-callback";

import { THREAD_ID_HEADER } from "./constants";
import {
  type SprigUIMessage,
  type ThreadMessageRecord,
  toUIMessages,
} from "./messages";

type UseSprigChatOptions = {
  mindmapId: Id<"mindmaps">;
  /** Called once per assistant turn that completed without abort or error. */
  onTurnFinished: (message: SprigUIMessage) => void;
};

type UseSprigChat = {
  messages: SprigUIMessage[];
  status: ReturnType<typeof useChat<SprigUIMessage>>["status"];
  error: Error | undefined;
  isStreaming: boolean;
  isHistoryLoading: boolean;
  clearError: () => void;
  sendPrompt: (text: string, selectedNodeId: string | null) => void;
  startNewConversation: () => void;
  stop: () => void;
};

/**
 * Owns the chat transport, the persisted thread, and history replay.
 *
 * The AI SDK's transport is constructed once and reads the thread id from the
 * response header the route sets, so the second turn of a conversation lands
 * in the same Convex thread as the first without a round trip to find it.
 */
function useSprigChat({
  mindmapId,
  onTurnFinished,
}: UseSprigChatOptions): UseSprigChat {
  // Written from inside `fetch`, read when composing the next request body.
  const threadIdRef = useRef<string | null>(null);
  const hasReplayedHistoryRef = useRef(false);

  const [transport] = useState(
    () =>
      new DefaultChatTransport<SprigUIMessage>({
        api: "/api/chat",
        /**
         * The thread id is only available as a response header, which the SDK
         * does not surface, so the transport's fetch seam captures it.
         */
        fetch: async (input, init) => {
          const response = await globalThis.fetch(input, init);
          const threadId = response.headers.get(THREAD_ID_HEADER);

          if (threadId !== null && threadId.length > 0) {
            threadIdRef.current = threadId;
          }

          return response;
        },
      })
  );

  const handleFinish = useEventCallback(
    ({
      message,
      isAbort,
      isError,
    }: {
      message: SprigUIMessage;
      isAbort: boolean;
      isError: boolean;
    }) => {
      if (isAbort || isError) {
        return;
      }

      onTurnFinished(message);
    }
  );

  const chat = useChat<SprigUIMessage>({
    id: mindmapId,
    transport,
    onFinish: handleFinish,
  });
  const { setMessages } = chat;

  // `undefined` means "not resolved yet"; `null` means "this map has no thread".
  const [historyThreadId, setHistoryThreadId] = useState<
    Id<"threads"> | null | undefined
  >(undefined);
  const threads = useQuery(api.threads.listThreads, { mindmapId });
  const historyMessages = useQuery(
    api.threads.listMessages,
    historyThreadId ? { threadId: historyThreadId } : "skip"
  );

  // Threads are listed oldest-first, so the most recent conversation is last.
  useEffect(() => {
    if (historyThreadId !== undefined || threads === undefined) {
      return;
    }

    const latestThread = threads.at(-1) ?? null;

    if (latestThread === null) {
      hasReplayedHistoryRef.current = true;
      setHistoryThreadId(null);
      return;
    }

    threadIdRef.current = latestThread._id;
    setHistoryThreadId(latestThread._id);
  }, [historyThreadId, threads]);

  // `listMessages` is a live query and keeps pushing as the route persists the
  // turn, so replay is allowed exactly once per conversation.
  useEffect(() => {
    if (hasReplayedHistoryRef.current || historyMessages === undefined) {
      return;
    }

    hasReplayedHistoryRef.current = true;
    setMessages(toUIMessages(historyMessages as ThreadMessageRecord[]));
  }, [historyMessages, setMessages]);

  const sendPrompt = useEventCallback(
    (text: string, selectedNodeId: string | null) => {
      void chat.sendMessage(
        { text },
        {
          body: {
            mindmapId,
            ...(threadIdRef.current === null
              ? {}
              : { threadId: threadIdRef.current }),
            ...(selectedNodeId === null ? {} : { selectedNodeId }),
          },
        }
      );
    }
  );

  const startNewConversation = useEventCallback(() => {
    // Nothing is deleted: the previous thread stays in Convex, this panel just
    // stops addressing it. P9 owns the thread switcher that can return to it.
    hasReplayedHistoryRef.current = true;
    threadIdRef.current = null;
    setHistoryThreadId(null);
    chat.clearError();
    setMessages([]);
  });

  const stop = useCallback(() => {
    void chat.stop();
  }, [chat]);

  const isStreaming =
    chat.status === "submitted" || chat.status === "streaming";

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    isStreaming,
    isHistoryLoading:
      !hasReplayedHistoryRef.current &&
      (historyThreadId === undefined || historyMessages === undefined),
    clearError: chat.clearError,
    sendPrompt,
    startNewConversation,
    stop,
  };
}

export { type UseSprigChat, useSprigChat };
